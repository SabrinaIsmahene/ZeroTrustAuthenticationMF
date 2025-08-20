// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <=0.9.0;

/// @title Semaphore contract interface adapted for Merkle Forest
interface ISemaphore {
    // ----- Errors -----
    error Semaphore__GroupHasNoMembers();
    error Semaphore__MerkleTreeDepthIsNotSupported();
    error Semaphore__MerkleTreeRootIsExpired();
    error Semaphore__MerkleTreeRootIsNotPartOfTheGroup();
    error Semaphore__YouAreUsingTheSameNullifierTwice();
    error Semaphore__InvalidProof();

    // ----- Structs -----
    struct Group {
        uint256 merkleTreeDuration;
        uint256 maxTreeSize;
        mapping(uint256 => bool) nullifiers;
        mapping(uint256 => uint256) merkleRootCreationDates; // root => timestamp
        uint256 currentTreeIndex; // sous-groupe actif
        uint256 globalMerkleRoot; // racine globale (Poseidon hash des sous-arbres)
    }

    struct SemaphoreProof {
        uint256[8] points;
        uint256 merkleTreeRoot;
        uint256 nullifier;
        uint256 treeIndex; // pour indiquer le sous-groupe
        uint256 merkleTreeDepth;
        uint256 message;
        uint256 scope;
    }

    // ----- Events -----
    event GroupMerkleTreeDurationUpdated(
        uint256 indexed groupId,
        uint256 oldMerkleTreeDuration,
        uint256 newMerkleTreeDuration
    );

    event ProofValidated(
        uint256 indexed groupId,
        uint256 treeIndex,
        uint256 merkleTreeDepth,
        uint256 indexed merkleTreeRoot,
        uint256 nullifier,
        uint256 message,
        uint256 scope,
        uint256[8] points
    );

    // ----- Getters -----
    function groupCounter() external view returns (uint256);

    function getCurrentTreeIndex(uint256 groupId) external view returns (uint256);

    /// 🌟 nouveau : exposer la racine globale du groupe
    function getGlobalRoot(uint256 groupId) external view returns (uint256);

    /// 🌟 nouveau : vérifier si un identityCommitment existe globalement
    function isGlobalMember(uint256 identityCommitment) external view returns (bool);

    // ----- Group management -----
    function createGroup() external returns (uint256);
    function createGroup(address admin) external returns (uint256);
    function createGroup(address admin, uint256 maxTreeSize) external returns (uint256);

    function updateGroupAdmin(uint256 groupId, address newAdmin) external;
    function acceptGroupAdmin(uint256 groupId) external;
    function updateGroupMerkleTreeDuration(uint256 groupId, uint256 newMerkleTreeDuration) external;

    // ----- Member management -----
    function addMember(uint256 groupId, uint256 identityCommitment) external;
    function addMembers(uint256 groupId, uint256[] calldata identityCommitments) external;

    function updateMember(
        uint256 groupId,
        uint256 treeIndex,
        uint256 oldIdentityCommitment,
        uint256 newIdentityCommitment,
        uint256[] calldata merkleProofSiblings
    ) external;

    function removeMember(
        uint256 groupId,
        uint256 treeIndex,
        uint256 identityCommitment,
        uint256[] calldata merkleProofSiblings
    ) external;

    // ----- Proof verification -----
    function validateProof(uint256 groupId, SemaphoreProof calldata proof) external;
    function verifyProof(uint256 groupId, SemaphoreProof calldata proof) external view returns (bool);
}
