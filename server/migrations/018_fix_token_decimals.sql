-- Fix incorrect decimals in tokens table
-- Run this to correct USDT and USDC decimals on BSC

SET search_path TO public;

-- Fix USDT BSC decimals (should be 18, not 6)
UPDATE tokens
SET decimals = 18, updated_at = NOW()
WHERE address = '0x55d398326f99059ff775485246999027b3197955'
  AND network = 'bsc'
  AND decimals != 18;

-- Fix USDC BSC decimals (should be 18, not 6)
UPDATE tokens
SET decimals = 18, updated_at = NOW()
WHERE address = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'
  AND network = 'bsc'
  AND decimals != 18;

-- Verify the fixes
SELECT address, symbol, decimals, network, updated_at
FROM tokens
WHERE network = 'bsc'
  AND address IN (
    '0x55d398326f99059ff775485246999027b3197955', -- USDT
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', -- USDC
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'  -- WBNB (should be 18)
  )
ORDER BY address;