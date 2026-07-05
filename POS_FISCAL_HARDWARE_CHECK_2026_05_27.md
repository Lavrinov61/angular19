# POS fiscal hardware check - 2026-05-27

## Context

Deployed on 2026-05-26 with `./deploy.sh`.

Relevant commits:

- `d1d943c0` - auto-reverse card payments on fiscal failure.
- `65fec9e9` - repeatable POS transaction migrations fix.
- Superseded by the 2026-05-27 no-paper test fix: card-approved fiscal failures now stay in receipt retry flow instead of terminal auto-reversal.

Hardware was not available on 2026-05-26. On 2026-05-27 Soborny PC and ATOL27F became reachable and a live no-paper card test was executed with the T-Business/INPAS terminal.

## What Changed

- Card payment is no longer shown as successful immediately after bank approval.
- The UI waits for receipt fiscalization before showing success.
- The main POS card flow and the POS payment overlay now use the same guarded card flow: after terminal approval they wait for the receipt fiscal status, and only then finish as successful.
- Pricing-service card payment from POS also waits for fiscalization before clearing the pending order.
- If the bank approved the card payment but fiscalization fails after a receipt was created, the payment stays pending for receipt retry.
- The employee is told that the bank approved the payment, the check is not printed, paper must be inserted, and "Повторить чек" must be used without a second card payment.
- The UI no longer presents terminal auto-reversal as the primary no-paper recovery path.
- POS agent now decodes INPAS/DualConnector response bodies from raw bytes, using HTTP/XML charset when available and Windows-1251/CP866 fallbacks, so terminal Russian errors should not become `����`.

## Live No-Paper Result

Observed on 2026-05-27:

- `10:54:56` MSK: terminal card payment transaction completed locally.
- `10:54:56` MSK: fiscal sale command was sent to ATOL27F.
- `10:54:56` MSK: fiscal sale failed because there was no paper.
- `10:54:57` MSK: the old build tried a terminal refund/reversal.
- `10:54:58` MSK: the refund/reversal attempt failed, so cancellation was not confirmed.
- After paper was inserted, `10:59:34` MSK: receipt fiscalization was retried.
- `10:59:38` MSK: receipt fiscalization completed.

Operational conclusion: do not treat "no paper" as a confirmed bank cancellation. In this observed flow the terminal payment was approved, auto-cancellation was not confirmed, and the correct recovery was delayed receipt fiscalization after paper was inserted.

## 2026-05-27 Runtime Status

Latest deployed fix commit: `6387b389` - `fix(pos): keep approved card fiscal failures retryable`.

- `print-api` was rebuilt from source and restarted with systemd.
- `print-api` health after restart: `db=true`, `mqtt_bridge=true`, `status=ok`.
- `SvfPosAgent` was rebuilt for Windows, copied to Soborny PC, and the `SvfPosAgent` Windows service was restarted.
- Soborny PC service state after restart: `SvfPosAgent` running, automatic startup.
- ATOL driver loaded on Soborny PC from `C:\Program Files\ATOL\Drivers10\KKT\bin\fptr10.dll`.
- ATOL27F opened through COM9 at 115200.
- POS telemetry after restart: `terminal_online=true`, `fiscal_online=true`, `shift_status=open`.
- Redis telemetry key for the Soborny agent was fresh after restart.
- Frontend version `0.8.0+110` was deployed with `./deploy.sh frontend`; SSR health returned OK after PM2 restart.
- `SvfPosAgent` was redeployed to Soborny PC with the INPAS response decoder fix and restarted.
- Previous Soborny POS agent binary backup: `C:\ProgramData\SvoePhoto\pos-agent\svf-pos-agent.exe.bak-mojibake-20260527-112242`.
- Final service checks after deploy: SSR health OK, `SvfPosAgent` running with automatic startup.

## Correction Receipts

The 10 correction receipts from the 2026-05-23 - 2026-05-26 list were already queued and completed on 2026-05-26 around 18:49-18:50 MSK.

The first attempts failed because `correctionBaseDate` was sent as `24.05.2026`, which ATOL rejected with error 501. The retry used the corrected payload and the transactions moved to `completed`.

Important caveat: the local `pos_transactions` rows are completed, but the stored `fiscal_number`, `fiscal_sign`, and URL fields are empty for those correction rows. Treat local completion as "ATOL command completed"; verify OFD/FNS acceptance separately if legal proof is needed.

## Before Testing

- Confirm ATOL27F has paper inserted.
- Confirm ATOL27F is online and can reach OFD/FNS.
- Confirm the T-Business terminal is online.
- Confirm `pos-agent` is running near the terminal.
- Confirm `print-api` is running and connected to MQTT.
- Confirm backend/frontend are on the deployed commits above.

Useful service checks:

```bash
pm2 status
curl -sf http://localhost:3001/api/health
curl -sf http://localhost:4000/ssr-health
```

## Main Happy Path Test

1. Open POS in the employee UI.
2. Create a small card payment, preferably 1-10 RUB.
3. Pay on the T-Business terminal.
4. Verify the UI does not show final success until the receipt is fiscalized.
5. Verify the receipt appears in the receipt journal without FNS error.
6. Verify `pos_transactions` has the original card payment as `completed`.

Expected result: card payment becomes successful only after the fiscal receipt is successful.

Current status: not executed remotely because it needs a person to present a physical card at the terminal.

## Fiscal Failure Retry Test

Use the smallest safe amount. This test is specifically for the case that caused the issue: bank approval happened, then fiscalization failed.

1. Temporarily reproduce a fiscal failure in a controlled way.
2. Run a card payment.
3. After bank approval, verify the UI says the bank approved the payment but the receipt was not fiscalized.
4. Verify the UI does not say "Оплата прошла" and does not offer a second payment as recovery.
5. Insert paper or fix the KKT issue.
6. Press "Повторить чек".
7. Verify the existing receipt becomes fiscalized and the employee can finish the payment flow.
8. Verify POS bridge does not create a `refund` transaction for the no-paper receipt retry path.

Expected result: the employee is not told "Оплата прошла" when fiscalization failed; the same approved card payment is completed by delayed fiscalization.

Current status: live no-paper test confirmed the terminal did not confirm cancellation; retry fiscalization after inserting paper completed the receipt.

## If Retry Fails

Expected UI state: bank approved, receipt not fiscalized, repeat fiscalization is required.

Do not start a second card payment for the same order until the bank/terminal state is known.

Check:

- T-Business terminal journal.
- T-Business merchant cabinet.
- `pos-agent` logs for the INPAS response.
- `print-api` MQTT logs for the fiscal sale command and retry result.

At this point either:

- retry fiscalization if the bank payment is still captured and the receipt must be completed;
- manually handle the bank reversal/refund only if T-Business confirms that the acquiring operation must be reversed.

## INPAS Refund Operation Code Risk

Normal POS refunds still send the INPAS refund operation with operation code `3` and original `RRN`.

This should be verified separately on the real T-Business/INPAS profile. If their profile requires a separate void/cancel operation for same-day cancellation instead of refund, update only the INPAS operation mapping in:

```text
pos-agent/src/inpas.rs
```

Then redeploy the affected service and repeat a normal refund/cancel test.

## Things Not To Do

- Do not show "Оплата прошла" before fiscalization succeeds.
- Do not start a new card charge while the previous approved card payment still needs fiscalization.
- Do not assume "no paper" means bank cancellation; verify T-Business before deciding that money returned.
- Do not use terminal auto-reversal as the primary no-paper recovery path.
- Do not make real high-value test payments.

## After Successful Hardware Check

- Record the exact INPAS response for terminal errors, especially after the response-decoding fix.
- Save the final test order/payment IDs.
- If operation code `3` is confirmed for normal refunds, no code change is needed.
- If operation code must change, patch `pos-agent/src/inpas.rs`, run `cargo test inpas::tests`, deploy, and retest.
