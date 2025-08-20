// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <=0.9.0;

import {ISemaphore} from "./interfaces/ISemaphore.sol";
import {SemaphoreGroups} from "./base/SemaphoreGroups.sol";
import {MIN_DEPTH, MAX_DEPTH} from "./base/Constants.sol";
import {ISemaphoreVerifier} from "./interfaces/ISemaphoreVerifier.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/// @title Semaphore adapted for Merkle Forest with on-chain subgroup roots and global group root
contract Semaphore is ISemaphore, SemaphoreGroups {
    ISemaphoreVerifier public verifier;

    mapping(uint256 => Group) public groups;
    uint256 public groupCounter;

    constructor(ISemaphoreVerifier _verifier) {
        verifier = _verifier;
    }

    // ---------------- Groups management ----------------

    function createGroup() external override returns (uint256 groupId) {
        return createGroup(msg.sender, 1024);
    }

    function createGroup(address admin) external override returns (uint256 groupId) {
        return createGroup(admin, 1024);
    }

    function createGroup(address admin, uint256 maxTreeSize) public override returns (uint256 groupId) {
        groupId = groupCounter++;
        _createGroup(groupId, admin, maxTreeSize);
        groups[groupId].merkleTreeDuration = 1 hours;
        groups[groupId].maxTreeSize = maxTreeSize;
        groups[groupId].currentTreeIndex = 0;
        groups[groupId].globalMerkleRoot = 0;
    }

    function updateGroupAdmin(uint256 groupId, address newAdmin) external override {
        _updateGroupAdmin(groupId, newAdmin);
    }

    function acceptGroupAdmin(uint256 groupId) external override {
        _acceptGroupAdmin(groupId);
    }

    function updateGroupMerkleTreeDuration(
        uint256 groupId,
        uint256 newMerkleTreeDuration
    ) external onlyGroupAdmin(groupId) {
        uint256 oldDuration = groups[groupId].merkleTreeDuration;
        groups[groupId].merkleTreeDuration = newMerkleTreeDuration;
        emit GroupMerkleTreeDurationUpdated(groupId, oldDuration, newMerkleTreeDuration);
    }

    // ---------------- Members management ----------------

    function addMember(uint256 groupId, uint256 identityCommitment) external override {
        if (globalMembers[identityCommitment]) return;

        _addMember(groupId, identityCommitment);
        _updateGlobalRoot(groupId);
    }

    function addMembers(uint256 groupId, uint256[] calldata identityCommitments) external override {
        for (uint256 i = 0; i < identityCommitments.length; i++) {
            if (globalMembers[identityCommitments[i]]) continue;
            _addMember(groupId, identityCommitments[i]);
        }
        _updateGlobalRoot(groupId);
    }

    function updateMember(
        uint256 groupId,
        uint256 treeIndex,
        uint256 oldIdentityCommitment,
        uint256 newIdentityCommitment,
        uint256[] calldata merkleProofSiblings
    ) external override {
        if (globalMembers[newIdentityCommitment]) return;

        _updateMember(groupId, treeIndex, oldIdentityCommitment, newIdentityCommitment, merkleProofSiblings);
        _updateGlobalRoot(groupId);
    }

    function removeMember(
        uint256 groupId,
        uint256 treeIndex,
        uint256 identityCommitment,
        uint256[] calldata merkleProofSiblings
    ) external override {
        _removeMember(groupId, treeIndex, identityCommitment, merkleProofSiblings);
        _updateGlobalRoot(groupId);
    }

    // ---------------- Proofs ----------------

    function validateProof(uint256 groupId, SemaphoreProof calldata proof) external override {
        if (groups[groupId].nullifiers[proof.nullifier]) {
            revert Semaphore__YouAreUsingTheSameNullifierTwice();
        }

        if (!verifyProof(groupId, proof)) {
            revert Semaphore__InvalidProof();
        }

        groups[groupId].nullifiers[proof.nullifier] = true;

        emit ProofValidated(
            groupId,
            proof.treeIndex,
            proof.merkleTreeDepth,
            proof.merkleTreeRoot,
            proof.nullifier,
            proof.message,
            proof.scope,
            proof.points
        );
    }

    function verifyProof(
        uint256 groupId,
        SemaphoreProof calldata proof
    ) public view override onlyExistingGroup(groupId) returns (bool) {
        if (proof.merkleTreeDepth < MIN_DEPTH || proof.merkleTreeDepth > MAX_DEPTH) {
            revert Semaphore__MerkleTreeDepthIsNotSupported();
        }

        uint256 merkleTreeSize = getMerkleTreeSize(groupId, proof.treeIndex);
        if (merkleTreeSize == 0) {
            revert Semaphore__GroupHasNoMembers();
        }

        uint256 currentMerkleTreeRoot = getMerkleTreeRoot(groupId, proof.treeIndex);

        if (proof.merkleTreeRoot != currentMerkleTreeRoot) {
            uint256 creationDate = groups[groupId].merkleRootCreationDates[proof.merkleTreeRoot];
            uint256 duration = groups[groupId].merkleTreeDuration;

            if (creationDate == 0) revert Semaphore__MerkleTreeRootIsNotPartOfTheGroup();
            if (block.timestamp > creationDate + duration) revert Semaphore__MerkleTreeRootIsExpired();
        }

        return
            verifier.verifyProof(
                [proof.points[0], proof.points[1]],
                [[proof.points[2], proof.points[3]], [proof.points[4], proof.points[5]]],
                [proof.points[6], proof.points[7]],
                [proof.merkleTreeRoot, proof.nullifier, _hash(proof.message), _hash(proof.scope)],
                proof.merkleTreeDepth
            );
    }

    // ---------------- Utils ----------------

    function _hash(uint256 value) private pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(value))) >> 8;
    }

    // ---------------- Subgroup logic ----------------

    function _getNextTreeIndex(uint256 groupId) internal returns (uint256) {
        uint256 current = groups[groupId].currentTreeIndex;
        uint256 size = getMerkleTreeSize(groupId, current);

        if (size >= groups[groupId].maxTreeSize) {
            current += 1;
            groups[groupId].currentTreeIndex = current;
        }

        return current;
    }

    function getCurrentTreeIndex(uint256 groupId) external view override returns (uint256) {
        return groups[groupId].currentTreeIndex;
    }

    function getSubgroupMembers(uint256 groupId, uint256 treeIndex) external view override returns (uint256[] memory) {
        return subgroupMembers[groupId][treeIndex];
    }

    // ---------------- Global member check ----------------

    function isGlobalMember(uint256 identityCommitment) external view returns (bool) {
        return globalMembers[identityCommitment];
    }

    // ---------------- Global root update (Poseidon) ----------------

    function _updateGlobalRoot(uint256 groupId) internal {
        uint256 combinedRoot = 0;
        uint256 currentTreeIndex = groups[groupId].currentTreeIndex;

        for (uint256 i = 0; i <= currentTreeIndex; i++) {
            uint256 treeRoot = getMerkleTreeRoot(groupId, i);
            combinedRoot = PoseidonT3.hash([combinedRoot, treeRoot]);
        }

        groups[groupId].globalMerkleRoot = combinedRoot;
    }

    function getGlobalRoot(uint256 groupId) external view returns (uint256) {
        return groups[groupId].globalMerkleRoot;
    }
}
