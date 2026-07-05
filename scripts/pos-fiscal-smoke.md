# POS Fiscal Smoke And Reconciliation

Scope: Soborny 21 POS fiscal path for ATOL 27F and PAX AF6.

## Before Any Live Test

- Confirm the POS agent service is running on the Soborny Windows PC.
- Confirm the active POS agent row uses the same `studio_id` and `agent_id` as `config.toml`.
- Confirm `print-api` is the version that persists POS shift results and routes POS telemetry through the POS handler.
- Do not run sale/refund smoke tests until PAX AF6 is on Wi-Fi and reachable from the Soborny router.

## ATOL Shift Smoke

1. Query current Soborny `pos_transactions` for `shift_open`, `shift_close`, and stale `processing` rows.
2. Open a fiscal shift from CRM only if there is no known open shift.
3. Wait for `svoefoto/{studio_id}/pos/shift/result`.
4. Confirm the matching `pos_transactions.id` moves from `processing` to `completed` or `failed`.
5. Close the fiscal shift from CRM.
6. Confirm the matching `shift_close` row reaches `completed`.
7. If the row stays `processing`, reconcile only when both are true:
   - the exact command id exists in the POS agent `processed_keys`;
   - the POS agent log around that command has no ATOL shift failure.

## Fiscal Sale Smoke

1. Create a small test receipt in CRM.
2. Confirm `pos_transactions.receipt_id` stores the real receipt id.
3. Confirm the MQTT fiscal command uses `pos_transactions.id` as the result correlation key.
4. Wait for `svoefoto/{studio_id}/pos/transactions/{transaction_id}/result`.
5. Confirm `pos_transactions.status = 'completed'`.
6. Confirm fiscal fields are populated when ATOL returns them:
   - `fiscal_number`
   - `fiscal_sign`
   - `fiscal_receipt_url`
7. Confirm `pos_receipts.fiscal_status = 'success'`.

## Fiscal Refund Smoke

1. Use a real completed fiscal sale receipt.
2. Create a refund through CRM.
3. Confirm the refund transaction uses the same result-correlation rule as sale.
4. Confirm the refund row reaches `completed` or `failed`.
5. Confirm the CRM receives `pos:transaction_update` with the fiscal fields and error message when present.

## What Not To Auto-Reconcile

- Do not mark old `fiscal_sale` rows completed without the exact fiscal result payload or fiscal document data.
- Do not mark old `shift_open` rows completed if the POS agent log shows ATOL error 83 or any shift failure.
- Do not mark recent `cash_drawer` rows completed unless their processed key exists and there is no publish/result gap to investigate.
