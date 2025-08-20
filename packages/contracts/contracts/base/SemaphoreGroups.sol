// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <=0.9.0;

import {ISemaphoreGroups} from "../interfaces/ISemaphoreGroups.sol";
import {InternalLeanIMT, LeanIMTData} from "@zk-kit/lean-imt.sol/InternalLeanIMT.sol";

/// @title Semaphore groups contract with Merkle Forest concept (+ members snapshot)
/// @notice Ajoute un snapshot on-chain des membres par sous-groupe pour permettre
///         aux clients de reconstruire l'arbre off-chain et générer un Merkle path
///         sans rejouer tout l'historique des events.
abstract contract SemaphoreGroups is ISemaphoreGroups {
    using InternalLeanIMT for LeanIMTData;

    // --------------------------- Stockage IMT ---------------------------
    mapping(uint256 => mapping(uint256 => LeanIMTData)) internal merkleTrees;

    // --------------------------- Métadonnées groupe ---------------------
    mapping(uint256 => uint256) internal groupTreeCount;
    mapping(uint256 => uint256) internal maxTreeSize;
    mapping(uint256 => address) internal admins;
    mapping(uint256 => address) internal pendingAdmins;

    // mapping global pour tous les identityCommitments (évite doublons inter-sous-groupes)
    mapping(uint256 => bool) internal globalMembers;

    // --------------------------- Snapshot membres ----------------------
    mapping(uint256 => mapping(uint256 => uint256[])) internal subgroupMembers;

    // --------------------------- Modifiers ------------------------------
    modifier onlyGroupAdmin(uint256 groupId) {
        if (admins[groupId] != msg.sender) revert Semaphore__CallerIsNotTheGroupAdmin();
        _;
    }

    modifier onlyExistingGroup(uint256 groupId) {
        if (admins[groupId] == address(0)) revert Semaphore__GroupDoesNotExist();
        _;
    }

    // --------------------------- Lifecycle groupe ----------------------
    function _createGroup(uint256 groupId, address admin, uint256 _maxTreeSize) internal virtual {
        admins[groupId] = admin;
        maxTreeSize[groupId] = _maxTreeSize;
        groupTreeCount[groupId] = 1;
        emit GroupCreated(groupId);
        emit GroupAdminUpdated(groupId, address(0), admin);
    }

    function _updateGroupAdmin(uint256 groupId, address newAdmin) internal virtual onlyGroupAdmin(groupId) {
        pendingAdmins[groupId] = newAdmin;
        emit GroupAdminPending(groupId, msg.sender, newAdmin);
    }

    function _acceptGroupAdmin(uint256 groupId) internal virtual {
        if (pendingAdmins[groupId] != msg.sender) revert Semaphore__CallerIsNotThePendingGroupAdmin();
        address oldAdmin = admins[groupId];
        admins[groupId] = msg.sender;
        delete pendingAdmins[groupId];
        emit GroupAdminUpdated(groupId, oldAdmin, msg.sender);
    }

    // --------------------------- Members: add ---------------------------
    function _addMember(
        uint256 groupId,
        uint256 identityCommitment
    ) internal virtual onlyGroupAdmin(groupId) returns (uint256 merkleTreeRoot, uint256 treeIndex, uint256 index) {
        if (globalMembers[identityCommitment]) {
            treeIndex = groupTreeCount[groupId] - 1;
            index = getMerkleTreeSize(groupId, treeIndex);
            merkleTreeRoot = getMerkleTreeRoot(groupId, treeIndex);
            return (merkleTreeRoot, treeIndex, index);
        }

        treeIndex = groupTreeCount[groupId] - 1;
        index = getMerkleTreeSize(groupId, treeIndex);

        if (index >= maxTreeSize[groupId]) {
            treeIndex = groupTreeCount[groupId];
            groupTreeCount[groupId]++;
            index = 0;
        }

        merkleTreeRoot = merkleTrees[groupId][treeIndex]._insert(identityCommitment);
        globalMembers[identityCommitment] = true;
        subgroupMembers[groupId][treeIndex].push(identityCommitment);

        emit MemberAdded(groupId, treeIndex, index, identityCommitment, merkleTreeRoot);
    }

    function _addMembers(
        uint256 groupId,
        uint256[] calldata identityCommitments
    )
        internal
        virtual
        onlyGroupAdmin(groupId)
        returns (uint256[] memory roots, uint256[] memory treeIndexes, uint256[] memory indexes)
    {
        roots = new uint256[](identityCommitments.length);
        treeIndexes = new uint256[](identityCommitments.length);
        indexes = new uint256[](identityCommitments.length);

        for (uint256 i = 0; i < identityCommitments.length; i++) {
            (roots[i], treeIndexes[i], indexes[i]) = _addMember(groupId, identityCommitments[i]);
        }
    }

    // --------------------------- Members: update/remove -----------------
    function _updateMember(
        uint256 groupId,
        uint256 treeIndex,
        uint256 oldIdentityCommitment,
        uint256 newIdentityCommitment,
        uint256[] calldata merkleProofSiblings
    ) internal virtual onlyGroupAdmin(groupId) returns (uint256 merkleTreeRoot) {
        uint256 index = merkleTrees[groupId][treeIndex]._indexOf(oldIdentityCommitment);

        if (globalMembers[newIdentityCommitment]) {
            return getMerkleTreeRoot(groupId, treeIndex);
        }

        merkleTreeRoot = merkleTrees[groupId][treeIndex]._update(
            oldIdentityCommitment,
            newIdentityCommitment,
            merkleProofSiblings
        );

        delete globalMembers[oldIdentityCommitment];
        globalMembers[newIdentityCommitment] = true;

        subgroupMembers[groupId][treeIndex][index] = newIdentityCommitment;

        emit MemberUpdated(groupId, treeIndex, index, oldIdentityCommitment, newIdentityCommitment, merkleTreeRoot);
    }

    function _removeMember(
        uint256 groupId,
        uint256 treeIndex,
        uint256 identityCommitment,
        uint256[] calldata merkleProofSiblings
    ) internal virtual onlyGroupAdmin(groupId) returns (uint256 merkleTreeRoot) {
        uint256 index = merkleTrees[groupId][treeIndex]._indexOf(identityCommitment);

        merkleTreeRoot = merkleTrees[groupId][treeIndex]._remove(identityCommitment, merkleProofSiblings);

        delete globalMembers[identityCommitment];

        if (index < subgroupMembers[groupId][treeIndex].length) {
            subgroupMembers[groupId][treeIndex][index] = 0;
        }

        emit MemberRemoved(groupId, treeIndex, index, identityCommitment, merkleTreeRoot);
    }

    // --------------------------- Getters -------------------------------
    function getGroupAdmin(uint256 groupId) public view virtual override returns (address) {
        return admins[groupId];
    }

    function hasMember(
        uint256 groupId,
        uint256 treeIndex,
        uint256 identityCommitment
    ) public view virtual override returns (bool) {
        return merkleTrees[groupId][treeIndex]._has(identityCommitment);
    }

    function indexOf(
        uint256 groupId,
        uint256 treeIndex,
        uint256 identityCommitment
    ) public view virtual override returns (uint256) {
        return merkleTrees[groupId][treeIndex]._indexOf(identityCommitment);
    }

    function getMerkleTreeRoot(uint256 groupId, uint256 treeIndex) public view virtual override returns (uint256) {
        return merkleTrees[groupId][treeIndex]._root();
    }

    function getMerkleTreeDepth(uint256 groupId, uint256 treeIndex) public view virtual override returns (uint256) {
        return merkleTrees[groupId][treeIndex].depth;
    }

    function getMerkleTreeSize(uint256 groupId, uint256 treeIndex) public view virtual override returns (uint256) {
        return merkleTrees[groupId][treeIndex].size;
    }

    function getGroupTreeCount(uint256 groupId) public view returns (uint256) {
        return groupTreeCount[groupId];
    }

    function getMaxTreeSize(uint256 groupId) public view returns (uint256) {
        return maxTreeSize[groupId];
    }

    function getSubgroupMembers(
        uint256 groupId,
        uint256 treeIndex
    ) external view virtual onlyExistingGroup(groupId) returns (uint256[] memory) {
        return subgroupMembers[groupId][treeIndex];
    }
}
