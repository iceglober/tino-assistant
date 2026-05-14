# Incident Response Template

> **How to use this template:** Copy this file to `docs/incidents/YYYY-MM-DD-<slug>.md` for each incident. Fill in each section as the incident progresses. Delete placeholder text before sharing externally.

---

## Incident Summary

| Field | Value |
|---|---|
| **Incident ID** | INC-YYYY-MM-DD-NNN |
| **Severity** | P1 / P2 / P3 / P4 |
| **Status** | Detected / Triaging / Contained / Recovering / Resolved |
| **Detected at** | YYYY-MM-DD HH:MM UTC |
| **Resolved at** | YYYY-MM-DD HH:MM UTC (or "open") |
| **Incident commander** | @name |
| **Scribe** | @name |

---

## 1. Detection

**What triggered the alert?**

- [ ] Automated alert (CloudWatch alarm, audit log anomaly, safety filter denial)
- [ ] User report
- [ ] Admin observation
- [ ] External notification (vendor, regulator, affected individual)

**Alert details:**

```
Alert name:
Alert time:
Alert source:
Initial indicator:
```

**Triage questions to answer immediately:**

1. Is this a security incident, a reliability incident, or both?
2. Is PHI (Protected Health Information) potentially involved?
3. Is the incident ongoing or historical?

---

## 2. Triage

**Severity classification:**

| Severity | Criteria |
|---|---|
| **P1** | PHI breach confirmed or likely; service fully down; active attacker |
| **P2** | PHI breach possible; significant data loss; partial service outage |
| **P3** | No PHI involved; limited impact; service degraded |
| **P4** | No user impact; informational; near-miss |

**Assigned severity:** ___

**Rationale:**

> _Why this severity? What evidence supports it?_

**Affected systems:**

- [ ] tino agent (Slack DM handler)
- [ ] DynamoDB (conversation history, audit logs, config)
- [ ] AWS Bedrock (LLM inference)
- [ ] Secrets Manager (credentials)
- [ ] CloudWatch Logs
- [ ] Console (localhost admin UI)
- [ ] Scheduled tasks
- [ ] Specific capability: ___

**Affected users:**

- Number of users potentially affected: ___
- User IDs (if known): ___
- PHI categories potentially exposed: ___

---

## 3. Containment

**Immediate actions — complete in order:**

### 3a. Revoke compromised credentials

```bash
# Rotate AWS credentials if IAM key is suspected compromised
aws iam create-access-key --user-name tino-agent
aws iam delete-access-key --access-key-id <OLD_KEY_ID> --user-name tino-agent

# Rotate Slack tokens via Slack admin console
# https://api.slack.com/apps/<APP_ID>/oauth

# Rotate GitHub PAT via GitHub settings
# https://github.com/settings/tokens

# Rotate Linear API key via Linear settings
# https://linear.app/settings/api

# Rotate Google OAuth credentials via Google Cloud Console
# https://console.cloud.google.com/apis/credentials
```

### 3b. Disable affected capabilities

Via the tino console (http://localhost:3001) or directly via config:

```bash
# Disable a capability via the console API
curl -X PUT http://localhost:3001/api/capabilities/<id> \
  -H 'Content-Type: application/json' \
  -d '{"enabled": false}'
```

### 3c. Deactivate affected users (if account compromise)

```bash
# Deprovision a user via the console API
curl -X DELETE http://localhost:3001/api/users/<userId>
```

This sets the user's status to `deactivated`, deletes personal capability tokens, and logs an audit entry.

### 3d. Stop the tino process (if necessary)

```bash
# Graceful shutdown
kill -SIGTERM <PID>

# Or via Docker
docker stop tino
```

**Containment actions taken:**

| Time (UTC) | Action | By |
|---|---|---|
| | | |

**Is the incident contained?** Yes / No / Partial

---

## 4. Investigation

### 4a. Audit log review

Query the audit log for the affected user and time window:

```bash
# Via the compliance API
curl http://localhost:3001/api/compliance

# For DynamoDB deployments, query the audit table directly:
aws dynamodb query \
  --table-name tino \
  --index-name gsi1 \
  --key-condition-expression "gsi1pk = :pk AND gsi1sk >= :since" \
  --expression-attribute-values '{
    ":pk": {"S": "AUDIT_USER#<userId>"},
    ":since": {"S": "<timestamp-padded-16-digits>"}
  }'
```

**Audit log findings:**

> _What did the audit log show? List relevant entries with timestamps._

### 4b. CloudWatch Logs analysis

```bash
# Query CloudWatch Logs Insights
aws logs start-query \
  --log-group-name /tino/agent \
  --start-time <epoch-seconds> \
  --end-time <epoch-seconds> \
  --query-string 'fields @timestamp, @message | filter @message like /error/ | sort @timestamp desc | limit 100'
```

**CloudWatch findings:**

> _What did the logs show? Any anomalous patterns?_

### 4c. Root cause

**Root cause (preliminary):**

> _What caused the incident? Be specific._

**Contributing factors:**

> _What conditions allowed this to happen?_

**Timeline of events:**

| Time (UTC) | Event |
|---|---|
| | |

---

## 5. Recovery

**Recovery steps:**

1. [ ] Verify containment is complete
2. [ ] Rotate all potentially compromised credentials
3. [ ] Re-enable capabilities with new credentials
4. [ ] Verify audit logging is functioning
5. [ ] Run a test agent interaction to confirm service is healthy
6. [ ] Monitor for 24 hours post-recovery

**Recovery actions taken:**

| Time (UTC) | Action | By |
|---|---|---|
| | | |

**Service restored at:** ___

---

## 6. Documentation

### Incident report

**Executive summary (2–3 sentences):**

> _What happened, what was the impact, and what was done to resolve it?_

**Technical summary:**

> _Detailed technical description of the incident, root cause, and resolution._

**Impact assessment:**

- Users affected: ___
- PHI categories involved: ___
- Duration of exposure/outage: ___
- Data integrity: Intact / Compromised / Unknown

**Lessons learned:**

> _What would have prevented this? What would have detected it sooner?_

**Action items:**

| Action | Owner | Due date | Status |
|---|---|---|---|
| | | | |

---

## 7. Notification

### HIPAA Breach Notification Requirements

> **Important:** Consult your legal counsel before sending any breach notifications. The requirements below are a summary, not legal advice.

#### Determining if notification is required

A breach requires notification unless the covered entity can demonstrate a low probability that PHI was compromised, based on a risk assessment of:

1. The nature and extent of the PHI involved
2. Who accessed or could have accessed the PHI
3. Whether the PHI was actually acquired or viewed
4. The extent to which the risk has been mitigated

#### Notification timelines

| Recipient | Deadline | Trigger |
|---|---|---|
| **Affected individuals** | Within 60 days of discovery | Any breach of unsecured PHI |
| **HHS (Secretary)** | Within 60 days of end of calendar year | Breaches affecting <500 individuals |
| **HHS (Secretary)** | Within 60 days of discovery | Breaches affecting ≥500 individuals |
| **Prominent media** | Within 60 days of discovery | Breaches affecting ≥500 individuals in a state/jurisdiction |

#### Notification content (required elements)

Notifications to individuals must include:

1. Brief description of what happened, including the date of the breach and date of discovery
2. Description of the types of PHI involved
3. Steps individuals should take to protect themselves
4. Brief description of what the covered entity is doing to investigate, mitigate, and prevent future breaches
5. Contact information for individuals to ask questions

#### Notification status

| Recipient | Notification required? | Sent at | Method |
|---|---|---|---|
| Affected individuals | Yes / No / TBD | | |
| HHS | Yes / No / TBD | | |
| Media | Yes / No / TBD | | |

**Notification decision rationale:**

> _Why is notification required or not required? Reference the risk assessment._

---

## Appendix: Quick reference

### Useful commands

```bash
# Check tino process status
ps aux | grep tino

# View recent logs (Docker)
docker logs tino --tail 100 --follow

# Check DynamoDB table
aws dynamodb describe-table --table-name tino

# List recent audit entries (DynamoDB)
aws dynamodb scan \
  --table-name tino \
  --filter-expression "begins_with(pk, :prefix)" \
  --expression-attribute-values '{":prefix": {"S": "AUDIT#"}}' \
  --max-items 20

# Check Secrets Manager
aws secretsmanager list-secrets --filters Key=name,Values=tino
```

### Key contacts

| Role | Contact |
|---|---|
| Incident commander | _fill in_ |
| Security lead | _fill in_ |
| Legal counsel | _fill in_ |
| AWS support | https://console.aws.amazon.com/support |
| HHS OCR (breach reporting) | https://www.hhs.gov/hipaa/filing-a-complaint |
