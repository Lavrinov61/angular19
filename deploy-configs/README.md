# Fingerprint Prometheus Configs

## Применение (требуется sudo)

### 1. Scrape job
```bash
sudo tee -a /etc/prometheus/prometheus.yml < deploy-configs/prometheus-fingerprint-scrape.yml.patch
sudo promtool check config /etc/prometheus/prometheus.yml
sudo systemctl reload prometheus
```

### 2. Alert rules
```bash
sudo cp deploy-configs/prometheus-fingerprint-alerts.yml /etc/prometheus/rules/fingerprint-alerts.yml
# или добавить в существующий alerts.yml
sudo systemctl reload prometheus
```

### 3. Проверка
```bash
curl -s 'http://localhost:9090/api/v1/targets' | jq '.data.activeTargets[] | select(.labels.job=="fingerprint-server") | .health'
curl -s 'http://localhost:9090/api/v1/rules' | jq '.data.groups[] | select(.name=="fingerprint-alerts") | .rules | length'
```
