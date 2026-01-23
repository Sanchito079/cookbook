// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract MinimalSettlement {
    // EIP-712 Domain
    bytes32 public immutable DOMAIN_SEPARATOR;
    uint256 public immutable CHAIN_ID;

    string public constant NAME = "MinimalOrderBook";
    string public constant VERSION = "1";

    // Fee configuration
    address public immutable feeRecipient = 0x6e11b5c17258c3f3ea684881da4bb591c4c7be05;
    uint256 public constant feeBps = 3; // 0.03% taker fee

    struct MatchValidation {
        bytes32 hBuy;
        bytes32 hSell;
        uint256 buyCap;
        uint256 sellCap;
        address buyReceiver;
        address sellReceiver;
        uint256 fee;
        uint256 amountBaseAfterFee;
    }

    // Order struct
    struct Order {
        address maker;
        address tokenIn;   // what maker pays
        address tokenOut;  // what maker receives
        uint256 amountIn;  // max input
        uint256 amountOutMin; // min output for full amountIn
        uint256 expiration;
        uint256 nonce;
        address receiver; // can be zero for maker
        uint256 salt;
    }

    // Typehashes
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOutMin,uint256 expiration,uint256 nonce,address receiver,uint256 salt)"
    );

    mapping(address => uint256) public minNonce;
    mapping(bytes32 => bool) public cancelled;
    mapping(bytes32 => uint256) public filledAmountIn; // how much input spent

    event OrderCancelled(bytes32 indexed orderHash, address indexed maker, uint256 nonce);
    event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event Matched(bytes32 indexed buyHash, bytes32 indexed sellHash, address indexed matcher, uint256 amountBase, uint256 amountQuote);

    error BadSignature();
    error Expired();
    error InvalidOrder();
    error Overfill();
    error PriceTooLow();

    constructor() {
        uint256 cid;
        assembly {
            cid := chainid()
        }
        CHAIN_ID = cid;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                cid,
                address(this)
            )
        );
    }

    // ------------ internal helpers to reduce stack --------------
    function _pairIsValid(Order memory buy, Order memory sell) internal pure returns (bool) {
        return buy.tokenOut == sell.tokenIn && buy.tokenIn == sell.tokenOut;
    }

    function _remainingInput(bytes32 h, uint256 amtIn) internal view returns (uint256) {
        uint256 already = filledAmountIn[h];
        return already >= amtIn ? 0 : (amtIn - already);
    }

    function _erc20Cap(address token, address owner, uint256 rem) internal view returns (uint256) {
        uint256 allow = IERC20(token).allowance(owner, address(this));
        if (allow < rem) rem = allow;
        uint256 bal = IERC20(token).balanceOf(owner);
        if (bal < rem) rem = bal;
        return rem;
    }

    function _quoteNeeded(uint256 amountBase, uint256 sellAmountIn, uint256 sellMinOut) internal pure returns (uint256) {
        if (amountBase == 0) return 0;
        unchecked {
            uint256 num = amountBase * sellMinOut;
            return (num + sellAmountIn - 1) / sellAmountIn;
        }
    }

    function _buyerBaseFromQuote(uint256 quote, uint256 buyAmountIn, uint256 buyMinOut) internal pure returns (uint256) {
        if (buyAmountIn == 0) return 0;
        return (quote * buyMinOut) / buyAmountIn;
    }

    // ----------------- views --------------------
    function hashOrder(Order memory o) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                o.maker,
                o.tokenIn,
                o.tokenOut,
                o.amountIn,
                o.amountOutMin,
                o.expiration,
                o.nonce,
                o.receiver,
                o.salt
            )
        );
    }

    function getOrderDigest(Order memory o) public view returns (bytes32) {
        bytes32 hash = hashOrder(o);
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, hash));
    }

    function verifySignature(Order memory o, bytes memory sig) public view returns (bool) {
        bytes32 digest = getOrderDigest(o);
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(sig);
        address signer = ecrecover(digest, v, r, s);
        return signer == o.maker;
    }

    function availableToFill(Order memory o) public view returns (uint256) {
        if (o.expiration <= block.timestamp) return 0;
        if (o.nonce < minNonce[o.maker]) return 0;
        bytes32 h = hashOrder(o);
        if (cancelled[h]) return 0;
        uint256 already = filledAmountIn[h];
        if (already >= o.amountIn) return 0;
        uint256 rem = o.amountIn - already;
        rem = _erc20Cap(o.tokenIn, o.maker, rem);
        return rem;
    }

    // ----------------- admin --------------------
    function cancelOrder(Order memory o) external {
        require(msg.sender == o.maker, "only maker");
        bytes32 h = hashOrder(o);
        cancelled[h] = true;
        emit OrderCancelled(h, o.maker, o.nonce);
    }

    function setMinNonce(uint256 newMinNonce) external {
        uint256 prev = minNonce[msg.sender];
        require(newMinNonce >= prev, "nonce only increases");
        minNonce[msg.sender] = newMinNonce;
    }

    // min out for partial fill: (amountInToFill * amountOutMin) / amountIn
    function minAmountOutFor(Order memory o, uint256 amountInToFill) public pure returns (uint256) {
        if (o.amountIn == 0) return 0;
        return (amountInToFill * o.amountOutMin) / o.amountIn;
    }

    // ----------------- execution --------------------
    function fillOrder(Order memory o, bytes memory signature, uint256 amountInToFill, uint256 takerMinAmountOut) external {
        if (!verifySignature(o, signature)) revert BadSignature();
        if (o.expiration <= block.timestamp) revert Expired();
        if (o.nonce < minNonce[o.maker]) revert InvalidOrder();

        bytes32 h = hashOrder(o);
        if (cancelled[h]) revert InvalidOrder();
        uint256 already = filledAmountIn[h];
        if (already + amountInToFill > o.amountIn) revert Overfill();

        // Enforce maker's min-out proportionally for partial fills
        uint256 makerMinOut = minAmountOutFor(o, amountInToFill);
        if (makerMinOut == 0) revert PriceTooLow();
        if (takerMinAmountOut < makerMinOut) revert PriceTooLow();

        // Pull tokenIn from maker to msg.sender and pay tokenOut from msg.sender to receiver
        address receiver = o.receiver == address(0) ? o.maker : o.receiver;
        require(IERC20(o.tokenIn).transferFrom(o.maker, msg.sender, amountInToFill), "pull in");
        require(IERC20(o.tokenOut).transferFrom(msg.sender, receiver, takerMinAmountOut), "pay out");

        filledAmountIn[h] = already + amountInToFill;
        emit OrderFilled(h, o.maker, msg.sender, o.tokenIn, o.tokenOut, amountInToFill, takerMinAmountOut);
    }

    // Match a bid and an ask. amountBase = base units traded, amountQuote = quote units traded.
    // buy: tokenIn = quote, tokenOut = base
    // sell: tokenIn = base, tokenOut = quote
    function matchOrders(Order memory buy, bytes memory sigBuy, Order memory sell, bytes memory sigSell, uint256 amountBase, uint256 amountQuote) external {
        MatchValidation memory mv = _validateAndPrepareMatch(buy, sigBuy, sell, sigSell, amountBase, amountQuote);

        _executeMatchTransfers(buy, sell, mv.hBuy, mv.hSell, mv.buyReceiver, mv.sellReceiver, amountBase, amountQuote, mv.fee, mv.amountBaseAfterFee);
    }

    function _validateAndPrepareMatch(Order memory buy, bytes memory sigBuy, Order memory sell, bytes memory sigSell, uint256 amountBase, uint256 amountQuote)
        internal view returns (MatchValidation memory) {

        if (!verifySignature(buy, sigBuy)) revert BadSignature();
        if (!verifySignature(sell, sigSell)) revert BadSignature();
        if (buy.expiration <= block.timestamp || sell.expiration <= block.timestamp) revert Expired();
        if (buy.nonce < minNonce[buy.maker] || sell.nonce < minNonce[sell.maker]) revert InvalidOrder();
        if (!_pairIsValid(buy, sell)) revert InvalidOrder();

        // Check compatibility
        if (amountQuote < _quoteNeeded(amountBase, sell.amountIn, sell.amountOutMin)) revert PriceTooLow();
        if (amountBase < _buyerBaseFromQuote(amountQuote, buy.amountIn, buy.amountOutMin)) revert PriceTooLow();

        bytes32 hBuy = hashOrder(buy);
        bytes32 hSell = hashOrder(sell);

        // compute remaining and caps
        uint256 tmp = _remainingInput(hBuy, buy.amountIn);
        if (tmp == 0) revert InvalidOrder();
        uint256 buyCap = _erc20Cap(buy.tokenIn, buy.maker, tmp);

        tmp = _remainingInput(hSell, sell.amountIn);
        if (tmp == 0) revert InvalidOrder();
        uint256 sellCap = _erc20Cap(sell.tokenIn, sell.maker, tmp);

        if (amountBase > sellCap) revert Overfill();
        if (amountQuote > buyCap) revert Overfill();

        address buyReceiver = buy.receiver == address(0) ? buy.maker : buy.receiver;
        address sellReceiver = sell.receiver == address(0) ? sell.maker : sell.receiver;

        // Calculate taker fee (0.03% on amountBase, since buy is taker)
        uint256 fee = (amountBase * feeBps) / 10000;
        uint256 amountBaseAfterFee = amountBase - fee;

        return MatchValidation({
            hBuy: hBuy,
            hSell: hSell,
            buyCap: buyCap,
            sellCap: sellCap,
            buyReceiver: buyReceiver,
            sellReceiver: sellReceiver,
            fee: fee,
            amountBaseAfterFee: amountBaseAfterFee
        });
    }

    function _executeMatchTransfers(Order memory buy, Order memory sell, bytes32 hBuy, bytes32 hSell, address buyReceiver, address sellReceiver, uint256 amountBase, uint256 amountQuote, uint256 fee, uint256 amountBaseAfterFee) internal {
        require(IERC20(sell.tokenIn).transferFrom(sell.maker, buyReceiver, amountBaseAfterFee), "pull base to buyer");
        require(IERC20(sell.tokenIn).transferFrom(sell.maker, feeRecipient, fee), "pull base fee");
        require(IERC20(buy.tokenIn).transferFrom(buy.maker, sellReceiver, amountQuote), "pull quote to seller");

        unchecked {
            filledAmountIn[hBuy] = filledAmountIn[hBuy] + amountQuote;
            filledAmountIn[hSell] = filledAmountIn[hSell] + amountBase;
        }

        emit Matched(hBuy, hSell, msg.sender, amountBase, amountQuote);
    }

    function splitSignature(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "bad sig length");
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }
    function ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) { return a == 0 ? 0 : (a + b - 1) / b; }
}
