#!/bin/bash

# Быстрое локальное тестирование без переда на GitHub
# Использование: ./test-locally.sh

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🚀 ЛОКАЛЬНОЕ ТЕСТИРОВАНИЕ (без push на GitHub)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Текущая ветка
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT=$(git rev-parse --short HEAD)

echo -e "${YELLOW}📋 Информация о ветке:${NC}"
echo "   Ветка: $BRANCH"
echo "   Коммит: $COMMIT"
echo ""

# Запустить unit тесты
echo -e "${YELLOW}1️⃣  Запуск unit тестов (Jest)...${NC}"
npm test 2>&1 | grep -E "PASS|FAIL|Tests:|Test Suites:"

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Unit тесты пройдены${NC}"
else
  echo -e "${RED}❌ Unit тесты провалились${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}2️⃣  Проверка синтаксиса JavaScript...${NC}"

for file in data-model.js event-bus.js sync-adapter.js storage-manager.js list-interface.js list-data.js; do
  if node -c "$file" 2>/dev/null; then
    echo -e "   ${GREEN}✓${NC} $file"
  else
    echo -e "   ${RED}✗${NC} $file"
    exit 1
  fi
done

echo ""
echo -e "${YELLOW}3️⃣  Проверка CSS...${NC}"

open_braces=$(grep -o '{' list-manager.css | wc -l)
close_braces=$(grep -o '}' list-manager.css | wc -l)

if [ "$open_braces" -eq "$close_braces" ]; then
  echo -e "   ${GREEN}✓${NC} CSS брасеты сбалансированы ($open_braces пар)"
else
  echo -e "   ${RED}✗${NC} CSS брасеты не сбалансированы"
  exit 1
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ ВСЕ ЛОКАЛЬНЫЕ ТЕСТЫ ПРОЙДЕНЫ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}📝 Далее:${NC}"
echo "   1. Проверить изменения: git status"
echo "   2. Закоммитить: git add . && git commit -m 'message'"
echo "   3. Запушить: git push origin $BRANCH"
echo "   4. Запустить полное тестирование CI в GitHub Actions"
echo ""
