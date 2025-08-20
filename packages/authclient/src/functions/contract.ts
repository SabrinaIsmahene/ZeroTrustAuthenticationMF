import { ethers, Contract, EventLog } from "ethers"
import { EventEmitter } from "events"
import dotenv from "dotenv"
import fs from "fs"
import path from "path"
import { loadMembers, saveMembers, addMember, removeMember, updateMember, saveGroupId } from "./groupStorage"

dotenv.config()

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

export const blockchainEvents = new EventEmitter()

async function processEvent(eventName: string, handler: (...args: any[]) => void, fromBlock: number = 0) {
    const pastEvents = await contract.queryFilter(eventName, fromBlock, "latest")
    for (const e of pastEvents) {
        if ("args" in e && e.args) {
            handler(...(e as EventLog).args)
        }
    }
    contract.on(eventName, (...args: any[]) => {
        handler(...args)
    })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function startBlockchainListeners(contractInstance: Contract, myIdentityCommitment: bigint) {
    const deployBlock = 0
    const members = await loadMembers()

    await processEvent(
        "GroupCreated",
        (groupId) => {
            const idStr = groupId.toString()
            saveGroupId(idStr)
            blockchainEvents.emit("GroupCreated", idStr)
        },
        deployBlock
    )

    const pastMemberAddedEvents = await contract.queryFilter("MemberAdded", deployBlock, "latest")
    for (const e of pastMemberAddedEvents) {
        if (!("args" in e && e.args)) continue
        const [groupId, treeIndex, index, identityCommitment] = e.args
        if (identityCommitment.toString() === myIdentityCommitment.toString()) {
            addMember(members, groupId.toString(), identityCommitment.toString(), treeIndex.toString())
            saveMembers(members)
            saveGroupId(groupId.toString(), treeIndex.toString())
            blockchainEvents.emit(
                "MemberAddedProcessed",
                groupId.toString(),
                identityCommitment.toString(),
                treeIndex.toString()
            )
            listenToSubgroupHistoryAndRealtime(groupId.toString(), treeIndex, members)
        }
    }

    contract.on("MemberAdded", (groupId, treeIndex, index, identityCommitment) => {
        if (identityCommitment.toString() !== myIdentityCommitment.toString()) return
        addMember(members, groupId.toString(), identityCommitment.toString(), treeIndex.toString())
        saveMembers(members)
        saveGroupId(groupId.toString(), treeIndex.toString())
        blockchainEvents.emit(
            "MemberAddedProcessed",
            groupId.toString(),
            identityCommitment.toString(),
            treeIndex.toString()
        )
        listenToSubgroupHistoryAndRealtime(groupId.toString(), treeIndex, members)
    })
}

async function listenToSubgroupHistoryAndRealtime(groupId: string, treeIndex: number, members: any) {
    const events = ["MemberUpdated", "MemberRemoved", "MembersAdded"]
    for (const eventName of events) {
        const pastEvents = await contract.queryFilter(eventName, 0, "latest")
        for (const e of pastEvents) {
            if (!("args" in e && e.args)) continue
            const [eventGroupId, eventTreeIndex, ...rest] = e.args
            if (eventGroupId.toString() === groupId && eventTreeIndex === treeIndex) {
                processSubgroupEvent(eventName, e.args, members, groupId, treeIndex)
            }
        }
    }

    contract.on("MemberUpdated", (eventGroupId, eventTreeIndex, index, oldCommitment, newCommitment, merkleRoot) => {
        if (eventGroupId.toString() !== groupId || eventTreeIndex !== treeIndex) return
        updateMember(members, groupId, oldCommitment.toString(), newCommitment.toString(), treeIndex.toString())
        saveMembers(members)
        blockchainEvents.emit("MemberUpdatedProcessed", groupId, newCommitment.toString(), treeIndex.toString())
    })

    contract.on("MemberRemoved", (eventGroupId, eventTreeIndex, index, identityCommitment, merkleRoot) => {
        if (eventGroupId.toString() !== groupId || eventTreeIndex !== treeIndex) return
        removeMember(members, groupId, identityCommitment.toString(), treeIndex.toString())
        saveMembers(members)
        blockchainEvents.emit("MemberRemovedProcessed", groupId, identityCommitment.toString(), treeIndex.toString())
    })

    contract.on("MembersAdded", (eventGroupId, eventTreeIndex, startIndex, identityCommitments, merkleRoot) => {
        if (eventGroupId.toString() !== groupId || eventTreeIndex !== treeIndex) return
        identityCommitments.forEach((commitment: bigint) => {
            addMember(members, groupId, commitment.toString(), treeIndex.toString())
        })
        saveMembers(members)
    })
}

function processSubgroupEvent(eventName: string, args: any[], members: any, groupId: string, treeIndex: number) {
    if (eventName === "MemberUpdated") {
        const [, , index, oldCommitment, newCommitment] = args
        updateMember(members, groupId, oldCommitment.toString(), newCommitment.toString(), treeIndex.toString())
        blockchainEvents.emit("MemberUpdatedProcessed", groupId, newCommitment.toString(), treeIndex.toString())
    } else if (eventName === "MemberRemoved") {
        const [, , index, identityCommitment] = args
        removeMember(members, groupId, identityCommitment.toString(), treeIndex.toString())
        blockchainEvents.emit("MemberRemovedProcessed", groupId, identityCommitment.toString(), treeIndex.toString())
    } else if (eventName === "MembersAdded") {
        const [, , startIndex, identityCommitments] = args
        identityCommitments.forEach((commitment: bigint) => {
            addMember(members, groupId, commitment.toString(), treeIndex.toString())
        })
    }
}

// eslint-disable-next-line no-console
console.log("\nListening to MemberUpdates...")

export async function isAlreadyMember(commitment: bigint): Promise<boolean> {
    try {
        const result: boolean = await contract.isGlobalMember(commitment)
        return result
    } catch (error) {
        console.error(`Error verifying member:`, error)
        throw error
    }
}

export async function getMembersList(groupId: string, treeIndex: string): Promise<bigint[]> {
    const members: bigint[] = await contract.getSubgroupMembers(groupId, treeIndex)
    return members
}
