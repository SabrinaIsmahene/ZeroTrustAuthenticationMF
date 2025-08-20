/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable jest/valid-expect */
import { Group, Identity, SemaphoreProof, generateProof } from "@semaphore-protocol/core"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { expect } from "chai"
import { Signer, ZeroAddress } from "ethers"
import { run } from "hardhat"
// @ts-ignore
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs"
// @ts-ignore
import { Semaphore } from "../typechain-types"

describe("Semaphore", () => {
    async function deploySemaphoreFixture() {
        const { semaphore } = await run("deploy", { logs: false })
        const semaphoreContract: Semaphore = semaphore
        const accounts = await run("accounts", { logs: false })
        const accountAddresses = await Promise.all(accounts.map((signer: Signer) => signer.getAddress()))
        const groupId = 0

        return { semaphoreContract, accounts, accountAddresses, groupId }
    }

    describe("# createGroup", () => {
        it("Should create a group", async () => {
            const { semaphoreContract, accounts, accountAddresses, groupId } = await loadFixture(deploySemaphoreFixture)
            const transaction = semaphoreContract.connect(accounts[1])["createGroup(address)"](accountAddresses[1])
            await expect(transaction).to.emit(semaphoreContract, "GroupCreated").withArgs(groupId)
            await expect(transaction)
                .to.emit(semaphoreContract, "GroupAdminUpdated")
                .withArgs(groupId, ZeroAddress, accountAddresses[1])
        })
    })

    describe("# addMember / addMembers / updateMember / removeMember", () => {
        it("Should add a new member using the Merkle Forest sub-tree", async () => {
            const { semaphoreContract, accountAddresses, groupId } = await loadFixture(deploySemaphoreFixture)
            const member = new Identity("0").commitment
            await semaphoreContract["createGroup(address)"](accountAddresses[0])
            const transaction = await semaphoreContract.addMember(groupId, member)
            await expect(transaction)
                .to.emit(semaphoreContract, "MemberAdded")
                .withArgs(groupId, 0, 0, member, anyValue)
        })

        it("Should add multiple members to a group", async () => {
            const { semaphoreContract, accountAddresses, groupId } = await loadFixture(deploySemaphoreFixture)
            const members = [1n, 2n, 3n]
            await semaphoreContract["createGroup(address)"](accountAddresses[0])

            for (let i = 0; i < members.length; i += 1) {
                const transaction = await semaphoreContract.addMember(groupId, members[i])
                await expect(transaction)
                    .to.emit(semaphoreContract, "MemberAdded")
                    .withArgs(groupId, 0, i, members[i], anyValue)
            }
        })

        it("Should update a member in the group", async () => {
            const { semaphoreContract, accountAddresses, groupId } = await loadFixture(deploySemaphoreFixture)
            const members = [1n, 2n, 3n]
            const group = new Group()
            group.addMembers(members)

            await semaphoreContract["createGroup(address)"](accountAddresses[0])
            for (let i = 0; i < members.length; i += 1) {
                await semaphoreContract.addMember(groupId, members[i])
            }

            const newCommitment = 4n
            const { siblings } = group.generateMerkleProof(1) // 1 = index du membre à updater
            const transaction = await semaphoreContract.updateMember(groupId, 0, 2n, newCommitment, siblings)

            await expect(transaction)
                .to.emit(semaphoreContract, "MemberUpdated")
                .withArgs(groupId, 0, 1, 2n, newCommitment, anyValue)
        })

        it("Should remove a member from the group", async () => {
            const { semaphoreContract, accountAddresses, groupId } = await loadFixture(deploySemaphoreFixture)
            const members = [1n, 2n, 3n]
            const group = new Group()
            group.addMembers(members)

            await semaphoreContract["createGroup(address)"](accountAddresses[0])
            for (let i = 0; i < members.length; i += 1) {
                await semaphoreContract.addMember(groupId, members[i])
            }

            const { siblings } = group.generateMerkleProof(2) // 2 = index du membre à supprimer
            const transaction = await semaphoreContract.removeMember(groupId, 0, 3n, siblings)

            await expect(transaction).to.emit(semaphoreContract, "MemberRemoved").withArgs(groupId, 0, 2, 3n, anyValue)
        })
    })

    describe("# verifyProof / validateProof", () => {
        it("Should verify and validate proofs correctly with Merkle Forest", async () => {
            const { semaphoreContract, accountAddresses, groupId } = await loadFixture(deploySemaphoreFixture)
            const members = Array.from({ length: 3 }, (_, i) => new Identity(i.toString())).map(
                ({ commitment }) => commitment
            )
            await semaphoreContract["createGroup(address)"](accountAddresses[0])
            for (let i = 0; i < members.length; i += 1) {
                await semaphoreContract.addMember(groupId, members[i])
            }

            const identity = new Identity("0")
            const group = new Group()
            group.addMembers(members)
            const message = 42
            const merkleTreeDepth = 12
            const proof: SemaphoreProof = await generateProof(identity, group, message, group.root, merkleTreeDepth)
            const proofStruct = { ...proof, treeIndex: 0 }

            const verified = await semaphoreContract.verifyProof(groupId, proofStruct)
            expect(verified).to.equal(true)

            const transaction = await semaphoreContract.validateProof(groupId, proofStruct)
            await expect(transaction)
                .to.emit(semaphoreContract, "ProofValidated")
                .withArgs(
                    groupId,
                    proofStruct.treeIndex,
                    proof.merkleTreeDepth,
                    proof.merkleTreeRoot,
                    proof.nullifier,
                    proof.message,
                    proof.scope,
                    proof.points
                )
        })
    })
})
