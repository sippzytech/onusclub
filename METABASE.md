# Wiring Metabase to Stampdeck

Stampdeck's prod MySQL container is already accessible to Metabase via Docker DNS — no SSH tunneling, no host port hopping. This runbook gets dashboards live in ~10 minutes.

## Prerequisites (one-time, done in DEPLOY.md)

- ✅ Metabase container is on the `n8n_default` Docker network.
- ✅ Stampdeck MySQL container (`stampdeck-mysql`) is on the same network.
- ✅ A read-only `reporting` user exists, granted `SELECT ON stampdeck.*`.
  The password is the `REPORTING_PASSWORD` value in `/docker/stampdeck/.env`.

## 1. Add the database to Metabase

In Metabase (your existing instance):

1. **Admin → Databases → Add database**.
2. Database type: **MySQL**.
3. Display name: `Stampdeck`.
4. Connection:
   - **Host**: `stampdeck-mysql` (Docker DNS — works because Metabase is on `n8n_default`)
   - **Port**: `3306`
   - **Database name**: `stampdeck`
   - **Username**: `reporting`
   - **Password**: the `REPORTING_PASSWORD` from your VPS `.env`
   - **Use a secure connection (SSL)**: off (it's inside the docker bridge)
5. **Save**.

Metabase will scan the schema. Within a minute you'll see `merchants`, `customers`, `loyalty_cards`, `card_events`, `loyalty_programs`, `broadcasts`, `sweep_runs`, `message_deliveries` etc. in the data browser.

## 2. Starter SQL queries (paste as saved questions)

Each block below is a single SQL query — paste into Metabase's SQL editor, hit **Save**.

### Top 10 cafés by active customers

```sql
SELECT
  m.business_name,
  COUNT(DISTINCT c.customer_id) AS active_customers,
  COUNT(c.id) AS active_cards
FROM merchants m
LEFT JOIN loyalty_cards c
  ON c.merchant_id = m.id AND c.status = 'active'
GROUP BY m.id, m.business_name
ORDER BY active_customers DESC
LIMIT 10;
```

### Stamps issued per day, last 30 days

```sql
SELECT
  DATE(created_at) AS day,
  COUNT(*) AS stamps_issued
FROM card_events
WHERE event_type = 'stamp'
  AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY day ASC;
```

### Redemption rate per merchant

```sql
SELECT
  m.business_name,
  SUM(e.event_type = 'stamp') AS stamps,
  SUM(e.event_type = 'redeem') AS redeems,
  ROUND(
    100 * SUM(e.event_type = 'redeem') /
    NULLIF(SUM(e.event_type = 'stamp'), 0),
    1
  ) AS redeem_pct
FROM merchants m
LEFT JOIN card_events e ON e.merchant_id = m.id
GROUP BY m.id, m.business_name
ORDER BY stamps DESC;
```

### Cards by status (active / blocked / expired)

```sql
SELECT
  m.business_name,
  SUM(c.status = 'active')  AS active,
  SUM(c.status = 'blocked') AS blocked,
  SUM(c.status = 'expired') AS expired
FROM merchants m
LEFT JOIN loyalty_cards c ON c.merchant_id = m.id
GROUP BY m.id, m.business_name
ORDER BY active DESC;
```

### Most engaged customers (top 20 lifetime stamps)

```sql
SELECT
  m.business_name,
  cu.name AS customer_name,
  JSON_UNQUOTE(JSON_EXTRACT(c.card_state, '$.total_lifetime')) AS lifetime_stamps,
  JSON_UNQUOTE(JSON_EXTRACT(c.card_state, '$.rewards_redeemed')) AS rewards_redeemed
FROM loyalty_cards c
JOIN merchants m ON m.id = c.merchant_id
JOIN customers cu ON cu.id = c.customer_id
WHERE c.status = 'active'
ORDER BY lifetime_stamps DESC NULLS LAST
LIMIT 20;
```

### Broadcast delivery success rate

```sql
SELECT
  m.business_name,
  b.header,
  b.scanned,
  b.sent,
  b.failed,
  ROUND(100 * b.sent / NULLIF(b.scanned, 0), 1) AS success_pct,
  b.started_at
FROM broadcasts b
JOIN merchants m ON m.id = b.merchant_id
ORDER BY b.started_at DESC
LIMIT 50;
```

### Daily new merchants signups (last 30 days)

```sql
SELECT
  DATE(created_at) AS day,
  COUNT(*) AS new_merchants
FROM merchants
WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY day ASC;
```

## 3. Wire into a dashboard

In Metabase: **+ New → Dashboard → "Stampdeck overview"**. Drag each saved question onto the grid. Set the dashboard to auto-refresh every 5 minutes if you want it on a wall display.

## Troubleshooting

**"Can't connect to MySQL server"**
- Check `docker network inspect n8n_default | grep -A 2 stampdeck-mysql` — should list the mysql container.
- If not: `docker network connect n8n_default stampdeck-mysql` (then restart, it'll persist).

**"Access denied for user 'reporting'@..."**
- Confirm `REPORTING_PASSWORD` env on the VPS matches what you're pasting into Metabase. The user was created on first MySQL boot from the init script; if `.env` was changed after, the user wasn't updated.
- Fix: connect as root in the mysql container and re-create the user with the new password:
  ```
  docker exec -it stampdeck-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD"
  ALTER USER 'reporting'@'%' IDENTIFIED BY '<new password>';
  FLUSH PRIVILEGES;
  ```

**Schema doesn't show new tables added by recent migrations**
- In Metabase, go to **Admin → Databases → Stampdeck → Sync database schema now**. Picks up new tables within a minute.
