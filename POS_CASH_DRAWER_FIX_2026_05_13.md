# POS Cash Drawer Fix, 2026-05-13

Context: cash drawer connected to ATOL 27F at Soborny did not open automatically on cash payments.

## What Was Found

- POS computer: `MAGNUSPHOTO`, SSH alias `soborny-pc`.
- POS agent service: `SvfPosAgent`.
- ATOL connection on that PC: `fptr10.dll`, `COM9`, `115200`.
- The installed `svf-pos-agent.exe` did not contain `cash_drawer`, `openCashDrawer`, or `Opening cash drawer`, so it could not handle the MQTT cash drawer command.
- Live database constraint on `pos_transactions.transaction_type` did not include `cash_drawer`, so backend/manual queue attempts failed before reaching `print-api`.
- After the DB constraint was fixed, `print-api` still failed to dispatch POS transactions because it decoded `pos_transactions.amount NUMERIC` directly as Rust `f64`.

## Actions Taken

- Opened the cash drawer once directly with a temporary helper using ATOL `fptr10.dll`.
- Built and installed a new Windows `pos-agent` on `MAGNUSPHOTO`.
- Backed up the old agent binary as:
  `C:\ProgramData\SvoePhoto\pos-agent\svf-pos-agent.exe.bak-cashdrawer-20260513-192740`
- Restarted `SvfPosAgent`; service returned to `Running`.
- Applied existing migration:
  `backend/database/migrations/zz_20260513_pos_cash_drawer_transaction.sql`
- Fixed `print-api` POS transaction fetch to cast `pt.amount::float8 AS amount`.
- Rebuilt and restarted `print-api`.

## Verification

- Direct ATOL helper returned `ok`.
- New agent binary contains `cash_drawer` and `Opening cash drawer`.
- `SvfPosAgent` log showed:
  `Opening cash drawer` and `ATOL open cash drawer`.
- Test transaction completed:
  `f870773b-12f1-4bae-a8d1-115b2847458d`, `transaction_type=cash_drawer`, `status=completed`.
- `print-api` log showed the command was published and result updated to `completed`.

## Commit

- `98c98661 Fix POS transaction amount casting`

## Notes

- Generated `print-api/target/release/*` files were modified by the release build but should not be committed as source changes.
- If the drawer still does not physically open on site after successful software result, check the cash drawer cable, ATOL drawer port, and drawer lock/key state.
