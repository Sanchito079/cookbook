// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./OrderBook.sol";

/// @title Settlement contract for off-chain orderbook
/// @notice This contract settles matched orders by transferring ERC20 tokens between counterparties.
/// It supports:
/// - Single order fill (taker fills maker)
/// - Matching two maker orders (back-to-back settlement)
/// - Partial fills with pro-rata minOut enforcement
/// - EIP-712 signature verification
/// Indexing of new tokens on Pancake/Uniswap is off-chain; this contract is chain-agnostic for tokens.
contract Settlement is OrderBook {
    using SafeERC20 for IERC20;

    // ============ Events ============
    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    event Matched(
        bytes32 indexed buyHash,
        bytes32 indexed sellHash,
        address indexed matcher,
        uint256 amountBase,
        uint256 amountQuote
    );

    // ============ Errors ============
    error InvalidOrder();
    error BadSignature();
    error PriceTooLow();
    error Expired();
    error Overfill();

    // ============ Fill Single ============

    /// @notice Taker fills a maker order by supplying tokenOut and receiving tokenIn (or vice versa depending on perspective)
    /// @param order The signed maker order
    /// @param signature EIP-712 signature from maker
    /// @param amountInToFill The amount of maker.tokenIn to fill (<= availableToFill)
    /// @param takerMinAmountOut Minimum tokenOut taker expects for their side of the trade (slippage protection)
    function fillOrder(
        Order memory order,
        bytes calldata signature,
        uint256 amountInToFill,
        uint256 takerMinAmountOut
    ) external {
        if (order.expiration != 0 && block.timestamp > order.expiration) revert Expired();
        if (!isOrderValid(order)) revert InvalidOrder();
        if (!verifySignature(order, signature)) revert BadSignature();

        bytes32 h = hashOrder(order);
        if (amountInToFill == 0 || amountInToFill > (order.amountIn - filledAmountIn[h])) revert Overfill();

        // Compute maker's minimum and apply taker constraint without extra locals
        uint256 out = minAmountOutFor(order, amountInToFill);
        if (out < takerMinAmountOut) {
            out = takerMinAmountOut;
        }

        // Transfers (inline receiver resolution)
        IERC20(order.tokenOut).safeTransferFrom(
            msg.sender,
            (order.receiver == address(0) ? order.maker : order.receiver),
            out
        );
        IERC20(order.tokenIn).safeTransferFrom(order.maker, msg.sender, amountInToFill);

        // Update filled state
        filledAmountIn[h] += amountInToFill;

        emit OrderFilled(h, order.maker, msg.sender, order.tokenIn, order.tokenOut, amountInToFill, out);
    }

    // ============ Match Two Maker Orders ============

    /// @notice Match a buy and a sell order directly without AMM liquidity.
    /// The matcher provides no capital; only facilitates transfer between makers.
    /// Requirements:
    /// - buy.tokenIn == sell.tokenOut and buy.tokenOut == sell.tokenIn
    /// - Prices must be compatible: implied price from each order must cross.
    /// - amountBase and amountQuote define the executed trade quantities (in tokenIn of buy and tokenIn of sell respectively).
    function matchOrders(
        Order memory buy,            // maker wants to pay buy.tokenIn to receive buy.tokenOut
        bytes calldata sigBuy,
        Order memory sell,           // maker wants to pay sell.tokenIn to receive sell.tokenOut
        bytes calldata sigSell,
        uint256 amountBase           // amount of buy.tokenIn executed
    ) external {
        // Basic pair checks
        require(buy.tokenIn == sell.tokenOut && buy.tokenOut == sell.tokenIn, "pair mismatch");

        if (buy.expiration != 0 && block.timestamp > buy.expiration) revert Expired();
        if (sell.expiration != 0 && block.timestamp > sell.expiration) revert Expired();
        if (!isOrderValid(buy) || !isOrderValid(sell)) revert InvalidOrder();
        if (!verifySignature(buy, sigBuy) || !verifySignature(sell, sigSell)) revert BadSignature();

        // Check buy remaining inline without keeping hashes around
        {
            bytes32 hB = hashOrder(buy);
            uint256 buyRem = buy.amountIn - filledAmountIn[hB];
            require(amountBase > 0 && amountBase <= buyRem, "bad base amount");
        }

        // Minimum the buyer expects to receive (seller must deliver at least this)
        uint256 quote = minAmountOutFor(buy, amountBase);

        // Seller's remaining and price constraint checks inline
        {
            bytes32 hS = hashOrder(sell);
            require(quote <= sell.amountIn - filledAmountIn[hS], "sell remaining too low");
        }
        if (amountBase < minAmountOutFor(sell, quote)) revert PriceTooLow();

        // Transfers with inline receiver resolution
        IERC20(sell.tokenIn).safeTransferFrom(
            sell.maker,
            (buy.receiver == address(0) ? buy.maker : buy.receiver),
            quote
        );
        IERC20(buy.tokenIn).safeTransferFrom(
            buy.maker,
            (sell.receiver == address(0) ? sell.maker : sell.receiver),
            amountBase
        );

        // Update fill states (recompute hashes in limited scopes)
        {
            bytes32 hB2 = hashOrder(buy);
            filledAmountIn[hB2] += amountBase;
        }
        {
            bytes32 hS2 = hashOrder(sell);
            filledAmountIn[hS2] += quote;
            emit Matched(hashOrder(buy), hS2, msg.sender, amountBase, quote);
        }
    }
}
