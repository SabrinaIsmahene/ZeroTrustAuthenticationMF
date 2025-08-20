import { ethers } from "ethers"
import path from "path"
import fs from "fs"
import { Identity } from "@semaphore-protocol/identity"
import { generateProof } from "@semaphore-protocol/proof"
import { Group } from "@semaphore-protocol/group"
import { BigNumber } from "@ethersproject/bignumber"
import axios from "axios"
import dotenv from "dotenv"
import { Resolver } from "did-resolver"
import { getResolver as keyResolver } from "key-did-resolver"
import { createIssuerDID, issueVC } from "./src/issuer"
import { createHolderDID, saveVC, verifyVC, generateIdentityFromVC } from "./src/holder"
import { blockchainEvents, isAlreadyMember, getMembersList, startBlockchainListeners } from "./src/functions/contract"
import { loadMembers, getAllGroupIds, getMySubtree } from "./src/functions/groupStorage"

dotenv.config()

const PORT = process.env.PORT || 3333

const SERVER_URL = `http://localhost:${PORT}`

if (!process.env.ABI_PATH || !process.env.RPC_URL || !process.env.PRIVATE_KEY || !process.env.CONTRACT_ADDRESS) {
    throw new Error("\nEnvironnement Variables not found.")
}

const abiPath = path.resolve(process.env.ABI_PATH)
const contractJson = JSON.parse(fs.readFileSync(abiPath, "utf8"))
const { abi: contractAbi } = contractJson
const { CONTRACT_ADDRESS, RPC_URL, PRIVATE_KEY } = process.env
const provider = new ethers.JsonRpcProvider(RPC_URL)
const signer = new ethers.Wallet(PRIVATE_KEY, provider)
const contract = new ethers.Contract(CONTRACT_ADDRESS, contractAbi, signer)

async function addMember(groupId: string, identityCommitment: bigint) {
    try {
        await axios.post(`${SERVER_URL}/add-member`, {
            groupId,
            identityCommitment: identityCommitment.toString()
        })
        // eslint-disable-next-line no-console
        console.log("\nMembre added to the group.")
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("\nError adding member :", err)
    }
}

async function sendJoinProof(groupId: string, group: Group, identity: Identity, commitment: bigint) {
    const index = group.indexOf(commitment)

    if (index === -1) {
        throw new Error("\nCommitment not found in the group")
    }

    const scope = `join-${groupId}`
    const message = `join-${commitment.toString().slice(0, 8)}`

    const joinProof = await generateProof(identity, group.generateMerkleProof(index), message, scope)

    await axios
        .post(`${SERVER_URL}/group/${groupId}/join-proof`, {
            commitment: commitment.toString(),
            proof: joinProof,
            nullifier: joinProof.nullifier,
            scope
        })
        .then(() =>
            // eslint-disable-next-line no-console
            console.log("\nJoin Proof sent and accepted")
        )
        .catch((err) => console.error("\nError while sending Join Proof :", err.response?.data || err.message))
}

export async function sendModTrainProof(
    groupId: string,
    group: Group,
    identity: Identity,
    commitment: bigint,
    scope: string,
    deltaw: Array<bigint | BigNumber | number | string>
) {
    const index = group.indexOf(commitment)

    if (index === -1) {
        throw new Error("Commitment not found in the group")
    }
    const stringArray = deltaw.map((item) => {
        if (typeof item === "bigint") {
            return item.toString()
        }
        if (typeof item === "number") {
            if (!Number.isSafeInteger(item)) {
                throw new Error("Unsafe number in deltaw")
            }
            return item.toString()
        }
        if (typeof item === "string") {
            return item
        }
        throw new Error("Unsupported deltaw element type")
    })

    const jsonString = JSON.stringify(stringArray)
    const message: Uint8Array = new TextEncoder().encode(jsonString)
    const fullProof = await generateProof(identity, group.generateMerkleProof(index), message, scope)

    await axios
        .post(`${SERVER_URL}/group/${groupId}/modtrain-proof`, {
            fullProof,
            nullifier: fullProof.nullifier,
            message,
            scope
        })
        .then(() =>
            // eslint-disable-next-line no-console
            console.log("\nModel Update Proof sent and accepted")
        )
        .catch((err) => console.error("Error while sending Model Update Proof :", err.response?.data || err.message))
}

async function waitForMyTreeIndex(identityCommitment: bigint, groupId: string): Promise<string> {
    return new Promise((resolve) => {
        const handler = (_groupId: string, emittedCommitment: string, emittedTreeIndex: string) => {
            if (_groupId === groupId && emittedCommitment === identityCommitment.toString()) {
                blockchainEvents.off("MemberAddedProcessed", handler)
                resolve(emittedTreeIndex)
            }
        }
        blockchainEvents.on("MemberAddedProcessed", handler)
    })
}

export async function getMyIdentityCommitment(): Promise<{
    identity: Identity
    commitment: bigint
}> {
    // eslint-disable-next-line no-console
    console.log("\n\n\n1. Creating the DID Resolver")
    const resolver = new Resolver({
        ...keyResolver()
    })

    // eslint-disable-next-line no-console
    console.log("\n2. Creation of the Issuer's DID document")
    const issuer = await createIssuerDID()

    // eslint-disable-next-line no-console
    console.log("\n3. Creation of the Holder (device) DID document")
    const holderDidInstance = await createHolderDID()
    const holderDid = holderDidInstance.did

    // eslint-disable-next-line no-console
    console.log("\n4. Preparing device information")
    const deviceInfo = {
        serial: "SN-0012345678900",
        mac: "AA:BB:CC:DD:EE:FF"
    }

    // eslint-disable-next-line no-console
    console.log("\n5. Issuance of the VC (Verifiable Credential by Issuer)")
    const vcJwt = await issueVC(issuer, holderDid, deviceInfo)
    // eslint-disable-next-line no-console
    console.log("\nVC JWT issued\n")

    // eslint-disable-next-line no-console
    console.log("\n6. Holder-side VC verification")
    const holderVerifiedVC = await verifyVC(vcJwt, resolver)
    // eslint-disable-next-line no-console
    console.log("\nVC verified :\n", holderVerifiedVC, "\n")

    // eslint-disable-next-line no-console
    console.log("\n7. Backup of the VC")
    await saveVC(vcJwt)
    // eslint-disable-next-line no-console
    console.log("\nVC JWT saved in a json file\n")

    // eslint-disable-next-line no-console
    console.log("\n8. Generating Semaphore Identity from VC")
    const identityS = generateIdentityFromVC(holderVerifiedVC)
    // eslint-disable-next-line no-console
    console.log("\nSemaphore Identity :\n", identityS, "\n\n\n")
    return identityS
}

async function main(groupId: string, identity: Identity, commitment: bigint) {
    // eslint-disable-next-line no-console
    console.log("\n9. Sending a request to join a group to the server")

    const alreadyMember = await isAlreadyMember(commitment)

    let myTreeIndex: string | undefined
    let myTreeIndexPromise: Promise<string> | undefined

    if (!alreadyMember) {
        myTreeIndexPromise = waitForMyTreeIndex(commitment, groupId)
        await addMember(groupId, commitment)
        // eslint-disable-next-line no-console
        console.log("\nWaiting for member event processing...")
        myTreeIndex = await myTreeIndexPromise
    } else {
        // eslint-disable-next-line no-console
        console.log("\nAlready a member.")
        myTreeIndex = getMySubtree(groupId)
        if (!myTreeIndex) {
            throw new Error("No subgroups found for this groupId")
        }
    }

    const groupMembers = await getMembersList(groupId, myTreeIndex)
    // eslint-disable-next-line no-console
    console.log("\n10. The members of the subgroup :\n\n", groupMembers)

    const group = new Group(groupMembers)

    // eslint-disable-next-line no-console
    console.log("\n11. Sending proof of membership to the server")
    await sendJoinProof(groupId, group, identity, commitment)

    // eslint-disable-next-line no-console
    console.log("\n12. Sending proof of model update to the server")

    const scope = "round-1"
    const message = [BigInt(1), BigInt(2), BigInt(3)]
    await sendModTrainProof(groupId, group, identity, commitment, scope, message)
}

function waitForGroupCreated(): Promise<string> {
    return new Promise((resolve) => {
        blockchainEvents.once("GroupCreated", (groupId: string) => {
            resolve(groupId)
        })
    })
}

async function run() {
    const identityS = await getMyIdentityCommitment()
    const identity = identityS.identity
    const commitment = identityS.commitment

    await startBlockchainListeners(contract, commitment)

    const groupExistant = getAllGroupIds()
    let groupId: string
    if (groupExistant.length === 0) {
        // eslint-disable-next-line no-console
        console.log("\nWaiting for group creation...")
        groupId = await waitForGroupCreated()
    } else {
        groupId = groupExistant[0].groupId
        // eslint-disable-next-line no-console
        console.log("\nGroup exists with Id : ", groupId)
    }

    await main(groupId, identity, commitment)
}

run().catch(console.error)
