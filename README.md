# RealtyCalendar Promo Codes MCP

Local stdio MCP for planning and creating batches of promo codes in the RealtyCalendar booking module through a signed-in Google Chrome session. Uses Chrome DevTools Protocol and the browser form. Works with an account that can manage booking module promo codes. The UI currently uses Russian labels.

## Setup

Requires Node.js 22+, npm and Google Chrome. Install the locked dependencies with `npm ci`.

Start Chrome with a dedicated profile outside the repository and a loopback debugging port. Sign in to RealtyCalendar in that window. Do not use a personal browsing profile or expose the port to the network. Close the dedicated Chrome instance when finished.

```sh
google-chrome --user-data-dir=/path/outside/repo/rc-chrome-profile \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  https://realtycalendar.ru/auth/sign-in
```

On macOS, replace `google-chrome` with `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`. On Windows use the installed Chrome executable.

Register a stdio server in your client. Example configuration using a placeholder path and account number:

```json
{
  "mcpServers": {
    "realtycalendar-promocodes": {
      "command": "node",
      "args": ["/path/to/repository/src/server.js"],
      "env": {
        "RC_CDP_URL": "http://127.0.0.1:9222",
        "RC_ACCOUNT_ID": "12345"
      }
    }
  }
}
```

`RC_ACCOUNT_ID` is the number visible in the RealtyCalendar account menu. The server checks it before opening the promo form. The browser session stays in Chrome. Keep the profile and your client configuration outside Git.

If your agent already has access to a signed-in embedded browser, it can use the read-only plan and follow the RealtyCalendar form there. The write tool uses the dedicated Chrome CDP session configured above. The local MCP has no access to the host application's embedded browser session.

## Tools

1. `plan_promocodes` returns a batch ID, fingerprint, exact codes and normalized terms without connecting to Chrome.
2. `create_promocodes` takes the returned `batch_id`, `fingerprint` and `terms` plus `confirm: true`. It creates one code at a time and checks the list after each save. Save the plan privately so you can resume the same batch.

Example arguments for `plan_promocodes`:

```json
{
  "terms": {
    "count": 10,
    "discount": {"unit": "RUB", "value": 500},
    "expires_on": "2030-05-31",
    "booking_from": "2030-05-01",
    "booking_until": "2030-05-31",
    "stay_from": "2030-06-01",
    "stay_until": "2030-06-30",
    "max_uses": 1
  }
}
```

Use `percent` instead of `RUB` for percentages. The booking window controls when the reservation is made. The optional stay window restricts arrival and departure dates. All dates are calendar dates. Optional terms include `min_total_rub`, `min_nights`, `max_uses` and an uppercase alphanumeric `prefix`. Each batch supports 1–50 codes. RealtyCalendar codes apply across the booking module's properties.

If a save or verification fails, the response lists verified names and remaining names. Run the same plan to reconcile the list before retrying. `already_listed` means the name was visible, so the server skipped the write. It does not attest to current discount terms or redemption status. Run one writer per account and keep the plan private. For large batches configure a client timeout of at least 10 minutes or use smaller batches. If cancelled, the tool checks cancellation before the next save. An in-flight save can still succeed and will be reconciled by name on retry. A browser UI change may require updating the adapter.

Run `npm test` to verify the planner, retry behavior and MCP handshake. A staging or disposable account is recommended when checking the live form contract.
