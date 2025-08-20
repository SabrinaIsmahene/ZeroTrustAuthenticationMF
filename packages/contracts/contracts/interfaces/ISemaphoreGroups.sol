// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <=0.9.0;

/// @title SemaphoreGroups contract interface with Merkle Forest + subgroup members
interface ISemaphoreGroups {
    // ----- Errors specific to group management -----
    error Semaphore__GroupDoesNotExist();
    error Semaphore__CallerIsNotTheGroupAdmin();
    error Semaphore__CallerIsNotThePendingGroupAdmin();

    // ----- Events -----
    event GroupCreated(uint256 indexed groupId);
    event GroupAdminUpdated(uint256 indexed groupId, address indexed oldAdmin, address indexed newAdmin);
    event GroupAdminPending(uint256 indexed groupId, address indexed oldAdmin, address indexed newAdmin);

    event MemberAdded(
        uint256 indexed groupId,
        uint256 indexed treeIndex,
        uint256 index,
        uint256 identityCommitment,
        uint256 merkleTreeRoot
    );
    event MembersAdded(
        uint256 indexed groupId,
        uint256 indexed treeIndex,
        uint256 startIndex,
        uint256[] identityCommitments,
        uint256 merkleTreeRoot
    );
    event MemberUpdated(
        uint256 indexed groupId,
        uint256 indexed treeIndex,
        uint256 index,
        uint256 oldIdentityCommitment,
        uint256 newIdentityCommitment,
        uint256 merkleTreeRoot
    );
    event MemberRemoved(
        uint256 indexed groupId,
        uint256 indexed treeIndex,
        uint256 index,
        uint256 identityCommitment,
        uint256 merkleTreeRoot
    );

    // ----- Getter functions -----
    function getGroupAdmin(uint256 groupId) external view returns (address);
    function hasMember(uint256 groupId, uint256 treeIndex, uint256 identityCommitment) external view returns (bool);
    function indexOf(uint256 groupId, uint256 treeIndex, uint256 identityCommitment) external view returns (uint256);

    function getMerkleTreeRoot(uint256 groupId, uint256 treeIndex) external view returns (uint256);
    function getMerkleTreeDepth(uint256 groupId, uint256 treeIndex) external view returns (uint256);
    function getMerkleTreeSize(uint256 groupId, uint256 treeIndex) external view returns (uint256);

    // ----- Subgroup functions -----
    function getGroupTreeCount(uint256 groupId) external view returns (uint256);
    function getMaxTreeSize(uint256 groupId) external view returns (uint256);

    /// @notice Retourne tous les identityCommitments du sous-groupe donné
    /// @dev Les entrées =0 correspondent à des membres supprimés (préservent l’indexation)
    function getSubgroupMembers(uint256 groupId, uint256 treeIndex) external view returns (uint256[] memory);
}
