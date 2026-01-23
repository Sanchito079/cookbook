// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Minimal IERC20 interface
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

/// @title SafeERC20 - minimal safe wrappers for ERC20 ops
library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, value)
        );
        require(success, "SafeERC20: transfer failed");
        if (data.length > 0) {
            require(abi.decode(data, (bool)), "SafeERC20: transfer false");
        }
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, value)
        );
        require(success, "SafeERC20: transferFrom failed");
        if (data.length > 0) {
            require(abi.decode(data, (bool)), "SafeERC20: transferFrom false");
        }
    }

    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.approve.selector, spender, value)
        );
        require(success, "SafeERC20: approve failed");
        if (data.length > 0) {
            require(abi.decode(data, (bool)), "SafeERC20: approve false");
        }
    }
}

/// @title OrderBook base with EIP-712 order struct, validation, and state
/// @notice This contract holds order state (cancellations, nonces, fills) and signature verification.
/// Settlement/clearing is implemented in a separate contract which should inherit this one.
abstract contract OrderBook {
    using SafeERC20 for IERC20;

    // ============ EIP-712 domain ==========
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256(bytes("OrderBook"));
    bytes32 private constant VERSION_HASH = keccak256(bytes("1"));

    // ============ Order typing ============
    struct Order {
        address maker;       // order signer (must match signature signer)
        address tokenIn;     // asset maker is selling
        address tokenOut;    // asset maker will receive
        uint256 amountIn;    // total amount of tokenIn to sell across the order (supports partial fills)
        uint256 amountOutMin;// minimum total tokenOut maker expects if fully filled (linear pro-rata for partial)
        uint256 expiration;  // unix timestamp after which order is invalid
        uint256 nonce;       // maker-scoped nonce for cancellations/out-of-order invalidation
        address receiver;    // optional receiver of tokenOut; default to maker if zero
        uint256 salt;        // extra entropy to make hashes unique
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOutMin,uint256 expiration,uint256 nonce,address receiver,uint256 salt)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;

    // ============ State ============
    mapping(bytes32 => bool) public cancelled;                 // orderHash => cancelled flag
    mapping(address => uint256) public minNonce;                // maker => min valid nonce
    mapping(bytes32 => uint256) public filledAmountIn;          // orderHash => cumulative amountIn filled

    // ============ Events ============
    event OrderCancelled(bytes32 indexed orderHash, address indexed maker, uint256 nonce);
    event MinNonceUpdated(address indexed maker, uint256 newMinNonce);

    constructor() {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                chainId,
                address(this)
            )
        );
    }

    // ============ Views ============

    function hashOrder(Order memory order) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.maker,
                order.tokenIn,
                order.tokenOut,
                order.amountIn,
                order.amountOutMin,
                order.expiration,
                order.nonce,
                order.receiver,
                order.salt
            )
        );
    }

    function getOrderDigest(Order memory order) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, hashOrder(order)));
    }

    function isOrderValid(Order memory order) public view returns (bool) {
        if (order.maker == address(0)) return false;
        if (order.amountIn == 0) return false;
        if (order.expiration != 0 && block.timestamp > order.expiration) return false;
        if (order.nonce < minNonce[order.maker]) return false;
        bytes32 h = hashOrder(order);
        if (cancelled[h]) return false;
        if (filledAmountIn[h] >= order.amountIn) return false;
        return true;
    }

    function availableToFill(Order memory order) public view returns (uint256) {
        if (!isOrderValid(order)) return 0;
        bytes32 h = hashOrder(order);
        uint256 filled = filledAmountIn[h];
        if (filled >= order.amountIn) return 0;
        return order.amountIn - filled;
    }

    function minAmountOutFor(Order memory order, uint256 amountInToFill) public pure returns (uint256) {
        require(amountInToFill <= order.amountIn, "amount too large");
        // Linear pro-rata minimum acceptable amountOut for partial fills
        // floor division to ensure minimum bound is respected
        return (amountInToFill * order.amountOutMin) / order.amountIn;
    }

    // ============ Maker controls ============

    function cancelOrder(Order memory order) external {
        require(msg.sender == order.maker, "not maker");
        bytes32 h = hashOrder(order);
        require(!cancelled[h], "already cancelled");
        cancelled[h] = true;
        emit OrderCancelled(h, order.maker, order.nonce);
    }

    function setMinNonce(uint256 newMinNonce) external {
        require(newMinNonce > minNonce[msg.sender], "must increase");
        minNonce[msg.sender] = newMinNonce;
        emit MinNonceUpdated(msg.sender, newMinNonce);
    }

    // ============ Signature verification ============

    function verifySignature(Order memory order, bytes memory signature) public view returns (bool) {
        return _recover(getOrderDigest(order), signature) == order.maker;
    }

    function _recover(bytes32 digest, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "ecrecover failed");
        return signer;
    }
}
