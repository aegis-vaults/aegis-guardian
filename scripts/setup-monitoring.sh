#!/bin/bash
# ==================================
# Aegis Guardian - Monitoring Setup Script
# ==================================
# This script helps configure monitoring and alerting for the
# Aegis Guardian production deployment.
#
# Features:
# - Railway metrics configuration
# - External uptime monitoring setup guide
# - Log aggregation recommendations
# - Alert configuration templates
#
# Usage:
#   ./scripts/setup-monitoring.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Aegis Guardian - Monitoring Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Get service URL
SERVICE_URL=$(railway variables get BASE_URL 2>/dev/null || echo "")

if [ -z "$SERVICE_URL" ]; then
    echo -e "${YELLOW}Warning: BASE_URL not found. Please set it first.${NC}"
    echo "Run: railway variables --set BASE_URL=https://your-domain.railway.app"
    echo ""
fi

echo -e "${YELLOW}=== Step 1: Railway Built-in Monitoring ===${NC}"
echo ""
echo "Railway provides built-in metrics and logs."
echo ""
echo -e "1. View logs in real-time:"
echo -e "   ${BLUE}railway logs --follow${NC}"
echo ""
echo -e "2. View service metrics:"
echo -e "   - Go to: ${BLUE}https://railway.app/project/<your-project>${NC}"
echo -e "   - Click on your service"
echo -e "   - Navigate to the 'Metrics' tab"
echo ""
echo -e "3. Set up Railway webhooks for alerts:"
echo -e "   - Go to Project Settings > Webhooks"
echo -e "   - Add webhook URL for deployment notifications"
echo ""

echo -e "${YELLOW}=== Step 2: External Uptime Monitoring ===${NC}"
echo ""
echo "Set up external uptime monitoring to get alerted when your service goes down."
echo ""
echo -e "${GREEN}Recommended Services:${NC}"
echo ""
echo "1. UptimeRobot (Free tier available)"
echo "   - Website: https://uptimerobot.com"
echo "   - Monitor URL: $SERVICE_URL/api/health"
echo "   - Check interval: 5 minutes"
echo "   - Alert contacts: Email, SMS, Slack, Discord"
echo ""
echo "2. BetterUptime (Free tier available)"
echo "   - Website: https://betterstack.com/better-uptime"
echo "   - Monitor URL: $SERVICE_URL/api/health"
echo "   - Check interval: 30 seconds (paid), 3 minutes (free)"
echo "   - Features: Status pages, incident management"
echo ""
echo "3. Cronitor (Free tier available)"
echo "   - Website: https://cronitor.io"
echo "   - Monitor URL: $SERVICE_URL/api/health"
echo "   - Features: HTTP monitoring, cron job monitoring"
echo ""

echo -e "${YELLOW}=== Step 3: Error Tracking with Sentry ===${NC}"
echo ""
echo "Sentry provides real-time error tracking and performance monitoring."
echo ""
echo -e "${GREEN}Setup Steps:${NC}"
echo "1. Create Sentry account: https://sentry.io"
echo "2. Create new project (Node.js/Next.js)"
echo "3. Get your DSN from project settings"
echo "4. Set Sentry environment variables:"
echo ""
echo -e "   ${BLUE}railway variables --set SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx${NC}"
echo -e "   ${BLUE}railway variables --set SENTRY_TRACES_SAMPLE_RATE=0.1${NC}"
echo -e "   ${BLUE}railway variables --set SENTRY_ENVIRONMENT=production${NC}"
echo ""
echo "5. Redeploy: railway up"
echo ""

echo -e "${YELLOW}=== Step 4: Log Aggregation ===${NC}"
echo ""
echo "For advanced log analysis and searching, consider a log aggregation service."
echo ""
echo -e "${GREEN}Options:${NC}"
echo ""
echo "1. Logtail (Railway Integration)"
echo "   - Go to Railway project > Integrations"
echo "   - Add Logtail integration"
echo "   - Automatically streams logs"
echo ""
echo "2. Papertrail"
echo "   - Website: https://papertrailapp.com"
echo "   - Set up syslog forwarding from Railway"
echo ""
echo "3. DataDog"
echo "   - Website: https://datadoghq.com"
echo "   - Full observability platform"
echo "   - Install DataDog agent as sidecar"
echo ""

echo -e "${YELLOW}=== Step 5: Custom Alerts Configuration ===${NC}"
echo ""
echo "Configure alerts for critical events:"
echo ""

# Create alert configuration file
ALERT_CONFIG_FILE="monitoring/alerts.yml"
mkdir -p monitoring

cat > "$ALERT_CONFIG_FILE" <<EOF
# Aegis Guardian Alert Configuration
# Use this as a reference for setting up alerts in your monitoring service

alerts:
  # Service Health
  - name: Service Down
    condition: health_check_fails > 2 consecutive checks
    severity: critical
    notification:
      - email
      - slack
      - pagerduty
    description: "The Guardian service is not responding to health checks"

  - name: Database Connection Failed
    condition: database_status != "healthy"
    severity: critical
    notification:
      - email
      - slack
    description: "Cannot connect to PostgreSQL database"

  - name: Redis Connection Failed
    condition: redis_status != "healthy"
    severity: high
    notification:
      - email
      - slack
    description: "Cannot connect to Redis cache"

  # Performance
  - name: High Response Time
    condition: avg_response_time > 2000ms for 5 minutes
    severity: warning
    notification:
      - slack
    description: "API response time is degraded"

  - name: High Error Rate
    condition: error_rate > 5% for 5 minutes
    severity: high
    notification:
      - email
      - slack
    description: "Elevated error rate detected"

  # Resources
  - name: High Memory Usage
    condition: memory_usage > 90% for 5 minutes
    severity: warning
    notification:
      - slack
    description: "Service is using excessive memory"

  - name: High CPU Usage
    condition: cpu_usage > 80% for 10 minutes
    severity: warning
    notification:
      - slack
    description: "Service is using high CPU"

  # Application Specific
  - name: Event Listener Disconnected
    condition: event_listener_status == "disconnected" for 2 minutes
    severity: high
    notification:
      - email
      - slack
    description: "Solana event listener has disconnected"

  - name: Failed Transactions Spike
    condition: failed_transactions > 20 in 5 minutes
    severity: warning
    notification:
      - slack
    description: "Unusual number of failed transactions"

  - name: Override Approval Delay
    condition: pending_overrides_age > 1 hour
    severity: warning
    notification:
      - slack
    description: "Override requests are not being processed"

  # Security
  - name: Rate Limit Exceeded Frequently
    condition: rate_limit_exceeded > 100 in 1 minute
    severity: warning
    notification:
      - slack
    description: "Potential DDoS or abuse detected"

  - name: Authentication Failures
    condition: auth_failures > 50 in 5 minutes
    severity: high
    notification:
      - email
      - slack
    description: "High number of authentication failures (potential attack)"
EOF

echo -e "${GREEN}Alert configuration template created: ${ALERT_CONFIG_FILE}${NC}"
echo ""

echo -e "${YELLOW}=== Step 6: Health Check Monitoring ===${NC}"
echo ""
echo "Create a simple cron job to check health and send alerts:"
echo ""

# Create health check script
HEALTH_CHECK_SCRIPT="monitoring/health-check-cron.sh"

cat > "$HEALTH_CHECK_SCRIPT" <<'EOF'
#!/bin/bash
# Simple health check script for cron
# Add to crontab: */5 * * * * /path/to/health-check-cron.sh

SERVICE_URL="https://your-service.railway.app"
ALERT_EMAIL="your-email@example.com"
ALERT_WEBHOOK=""  # Optional: Slack/Discord webhook

# Check health endpoint
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$SERVICE_URL/api/health")

if [ "$RESPONSE" != "200" ]; then
    # Service is down or unhealthy
    MESSAGE="ALERT: Aegis Guardian is down or unhealthy (HTTP $RESPONSE)"

    # Send email (requires mail command)
    echo "$MESSAGE" | mail -s "Aegis Guardian Alert" "$ALERT_EMAIL"

    # Send to Slack/Discord webhook (optional)
    if [ -n "$ALERT_WEBHOOK" ]; then
        curl -X POST -H 'Content-Type: application/json' \
            -d "{\"text\":\"$MESSAGE\"}" \
            "$ALERT_WEBHOOK"
    fi

    # Log to syslog
    logger -t aegis-guardian "$MESSAGE"

    exit 1
fi

exit 0
EOF

chmod +x "$HEALTH_CHECK_SCRIPT"

echo -e "${GREEN}Health check script created: ${HEALTH_CHECK_SCRIPT}${NC}"
echo ""
echo "To use this script:"
echo "1. Edit the script and update SERVICE_URL and ALERT_EMAIL"
echo "2. Make it executable: chmod +x $HEALTH_CHECK_SCRIPT"
echo "3. Add to crontab: crontab -e"
echo "4. Add line: */5 * * * * /path/to/$HEALTH_CHECK_SCRIPT"
echo ""

echo -e "${YELLOW}=== Step 7: Dashboard Setup ===${NC}"
echo ""
echo "Create monitoring dashboards for visibility:"
echo ""
echo "1. Railway Dashboard (Built-in)"
echo "   - CPU, Memory, Network metrics"
echo "   - Request count and response times"
echo "   - Log streaming"
echo ""
echo "2. Grafana (Advanced)"
echo "   - Website: https://grafana.com"
echo "   - Connect to PostgreSQL for custom queries"
echo "   - Visualize transaction metrics"
echo "   - Set up alert rules"
echo ""
echo "3. Custom Status Page"
echo "   - Use statuspage.io or similar"
echo "   - Display uptime and incident history"
echo "   - Public-facing for users"
echo ""

echo -e "${YELLOW}=== Step 8: Notification Channels ===${NC}"
echo ""
echo "Set up notification channels for alerts:"
echo ""
echo -e "${GREEN}Slack Integration:${NC}"
echo "1. Create Slack webhook: https://api.slack.com/messaging/webhooks"
echo "2. Configure in monitoring service"
echo ""
echo -e "${GREEN}Discord Integration:${NC}"
echo "1. Create Discord webhook in server settings"
echo "2. Configure in monitoring service"
echo ""
echo -e "${GREEN}Email Notifications:${NC}"
echo "1. Most monitoring services support email by default"
echo "2. Set up distribution list for team"
echo ""
echo -e "${GREEN}PagerDuty (For critical alerts):${NC}"
echo "1. Create PagerDuty account: https://pagerduty.com"
echo "2. Set up escalation policies"
echo "3. Integrate with monitoring service"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Monitoring Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Set up at least one uptime monitor (UptimeRobot recommended)"
echo "2. Configure Sentry for error tracking"
echo "3. Review and customize alert thresholds"
echo "4. Test alerting by simulating failures"
echo "5. Document runbooks for common alerts"
echo ""
echo "Files created:"
echo "  - $ALERT_CONFIG_FILE (Alert configuration reference)"
echo "  - $HEALTH_CHECK_SCRIPT (Cron health check script)"
echo ""
