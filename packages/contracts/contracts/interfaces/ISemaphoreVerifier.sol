//SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <=0.9.0;

/// @title SemaphoreVerifier contract interface.
interface ISemaphoreVerifier {
    /// @dev Returns true if the proof was successfully verified.
    /// @param _pA: Point A.
    /// @param _pB: Point B.
    /// @param _pC: Point C.
    /// @param _pubSignals: Public signals.
    /// @param merkleTreeDepth: Merkle tree depth.
    /// @return True if the proof was successfully verified, false otherwise.
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[4] calldata _pubSignals,
        uint256 merkleTreeDepth
    ) external view returns (bool);
}
