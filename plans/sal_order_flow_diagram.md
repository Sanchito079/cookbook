# SAL Order Flow Architecture

```mermaid
sequenceDiagram
    participant P as Project Owner
    participant UI as Frontend UI
    participant API as Backend API
    participant DB as Database
    participant EX as Executor
    participant SC as Settlement Contract

    %% SAL Order Creation
    P->>UI: Create SAL Order<br/>(100k tokens @ $0.10)
    UI->>API: POST /api/sal-orders
    API->>DB: Insert SAL order record<br/>(is_sal_order=true, initial_price=0.10)
    DB-->>API: Order created
    API-->>UI: Success response
    UI-->>P: SAL Order active

    %% Price Query
    Note over EX: User wants to buy from SAL order
    EX->>API: GET /api/sal-orders/{id}/price
    API->>DB: Query current SAL price
    DB-->>API: Return current_price
    API-->>EX: Current price: $0.115

    %% Trade Execution
    EX->>SC: fillSALOrder(takerOrder, salOrder, amount)
    SC->>SC: Validate signatures & prices
    SC->>SC: Transfer tokens
    SC-->>EX: Trade executed

    %% Price Update
    EX->>API: POST /api/sal-orders/{id}/update<br/>(sold_amount: +1000)
    API->>DB: Update sal_sold_amount<br/>Recalculate sal_current_price
    DB-->>API: New price: $0.116
    API-->>EX: Price updated

    %% Analytics
    P->>UI: Check SAL performance
    UI->>API: GET /api/sal-orders/{id}/analytics
    API->>DB: Query analytics data
    DB-->>API: Price history, volume, etc.
    API-->>UI: Analytics data
    UI-->>P: Performance dashboard
```

## SAL Order State Flow

```mermaid
stateDiagram-v2
    [*] --> Created: Project creates SAL order
    Created --> Active: Order signed and stored
    Active --> Filling: Trades execute against order
    Filling --> Filling: Price adjusts with each trade
    Filling --> Depleted: All inventory sold
    Filling --> Cancelled: Project cancels order
    Depleted --> [*]
    Cancelled --> [*]

    note right of Filling
        - Price recalculated after each fill
        - Database updated with new price
        - UI shows current adaptive price
        - Analytics track performance
    end note
```

## Price Adjustment Curves

### Linear Curve Example
```
Initial: 10,000 tokens @ $1.00
After 2,000 sold: 8,000 tokens @ $1.20  (20% through inventory)
After 5,000 sold: 5,000 tokens @ $1.50  (50% through inventory)
After 8,000 sold: 2,000 tokens @ $1.80  (80% through inventory)
```

### Exponential Curve Example
```
Initial: 10,000 tokens @ $1.00
After 2,000 sold: 8,000 tokens @ $1.08  (slow increase early)
After 5,000 sold: 5,000 tokens @ $1.25  (accelerating)
After 8,000 sold: 2,000 tokens @ $1.72  (rapid increase late)
```

## Key Technical Components

1. **Database Layer**: Stores SAL order metadata and current state
2. **API Layer**: Provides price queries and order management
3. **Executor Integration**: Fetches current prices during matching
4. **Smart Contract**: Handles secure settlement at adaptive prices
5. **Frontend**: Displays dynamic pricing and analytics

## Security Flow

```mermaid
flowchart TD
    A[User Sees SAL Price] --> B[Signs Order with Price]
    B --> C[Executor Validates Price]
    C --> D[Contract Verifies Signature]
    D --> E[Trade Executes at Agreed Price]
    E --> F[Price Updates in Database]

    A --> G[Price Oracle Service]
    G --> H[Validates Price Reasonableness]
    H --> I[Prevents Manipulation]

    F --> J[New Price Available]
    J --> A
```

This architecture ensures SAL orders provide adaptive liquidity while maintaining security and preventing price manipulation.