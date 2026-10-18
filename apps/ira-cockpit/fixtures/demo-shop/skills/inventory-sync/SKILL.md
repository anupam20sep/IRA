---
name: inventory-sync
description: Sync Demo Shop inventory counts from the warehouse feed
---

# Inventory Sync

## When to use

Product stock looks stale or a warehouse webhook arrives.

## Steps

1. Pull the warehouse feed for SKUs in `docs/catalog-overview.md`.
2. Diff against local inventory.
3. Apply safe increments only; escalate negative stock to Ask-Me.
4. Record the sync in the decision log.
