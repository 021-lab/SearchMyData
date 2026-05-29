# SearchMyData — Server API (TerminusDB)

**Интерфейс:** [list-manager.html](https://htmlpreview.github.io/?https://raw.githubusercontent.com/021-lab/searchmydata/claude/nested-list-structure-8hrDx/list-manager.html?v=2986a43)

Документ описывает, как страница синхронизирует своё состояние с TerminusDB.
Каждое действие пользователя применяется в браузере, затем отправляется в TerminusDB.
TerminusDB хранит историю коммитов — это даёт нативный откат без дополнительного кода.

---

## 1. Среда и соглашения

```
Base URL  : http://localhost:6363
Team      : admin
Database  : searchmydata
Branch    : main
Path      : admin/searchmydata/local/branch/main
Auth      : Basic  admin:<password>
```

Каждый мутирующий запрос принимает query-параметры:

| Параметр | Описание |
|----------|----------|
| `author` | Идентификатор пользователя (e.g. `"user@app"`) |
| `message` | Описание изменения (e.g. `"edit item 1"`) |
| `graph_type` | `"instance"` (данные) или `"schema"` (схема) |

Каждый успешный мутирующий ответ возвращает заголовок:
```
TerminusDB-Data-Version: branch:main:hash:<COMMIT_ID>
```
Страница сохраняет `COMMIT_ID` последнего действия — он используется для отката.

---

## 2. Схема ListItem

Однократная загрузка схемы при инициализации БД:

```http
POST /api/document/admin/searchmydata/local/branch/main?graph_type=schema&author=admin&message=init+schema
Content-Type: application/json
```

```json
[
  {
    "@base": "ListItem/",
    "@schema": "http://searchmydata.local/schema#",
    "@type": "@context"
  },
  {
    "@type": "Class",
    "@id": "ListItem",
    "line1":     "xsd:string",
    "line2":     { "@type": "Optional", "@class": "xsd:string"  },
    "tags":      { "@type": "Set",      "@class": "xsd:string"  },
    "collapsed": { "@type": "Optional", "@class": "xsd:boolean" },
    "position":  "xsd:decimal",
    "parent":    { "@type": "Optional", "@class": "ListItem"    }
  }
]
```

**Модель дерева:** каждый элемент хранит ссылку `parent` на родителя (`null` для корневых).
Дерево восстанавливается клиентом: группировка по `parent` + сортировка по `position`.

---

## 3. Сводка эндпоинтов

| Назначение | Метод | Путь |
|-----------|-------|------|
| Загрузка всех элементов | GET | `/api/document/{path}?type=ListItem&as_list=true` |
| Поиск элементов | POST | `/api/woql/{path}` |
| Добавить элемент | POST | `/api/document/{path}?graph_type=instance&...` |
| Редактировать элемент | POST | `/api/patch/{path}` |
| Удалить элемент | DELETE | `/api/document/{path}?id=ListItem/{id}&...` |
| Управление тегами | POST | `/api/patch/{path}` |
| Свернуть / развернуть | POST | `/api/patch/{path}` |
| Перетащить (reorder) | POST | `/api/patch/{path}` |
| Откатить последнее действие | POST | `/api/reset/{path}` |
| История коммитов | GET | `/api/log/{path}` |

---

## 4. Действия

### 4.1 Загрузка всех элементов при открытии страницы

```http
GET /api/document/admin/searchmydata/local/branch/main
    ?type=ListItem&as_list=true&unfold=false
Authorization: Basic admin:<password>
```

**Ответ `200 OK`:**
```json
[
  { "@type": "ListItem", "@id": "ListItem/1",  "line1": "Молоко 3.2%", "line2": "2 пакета", "position": 0 },
  { "@type": "ListItem", "@id": "ListItem/2",  "line1": "Хлеб ржаной", "position": 1 },
  { "@type": "ListItem", "@id": "ListItem/26", "line1": "Бородинский", "line2": "400 г", "position": 0, "parent": { "@id": "ListItem/2" } },
  { "@type": "ListItem", "@id": "ListItem/27", "line1": "Столичный",   "line2": "500 г", "position": 1, "parent": { "@id": "ListItem/2" } }
]
```

Клиент восстанавливает дерево: элементы без `parent` → корень; остальные — дочерние по `parent.@id`, отсортированные по `position`.

---

### 4.2 Поиск по строке

Страница отправляет WOQL-запрос с регулярным выражением по полям `line1` и `line2`.

```http
POST /api/woql/admin/searchmydata/local/branch/main
Content-Type: application/json
Authorization: Basic admin:<password>
```

```json
{
  "query": {
    "@type": "And",
    "and": [
      {
        "@type": "Triple",
        "subject":   { "@type": "Variable", "name": "Doc" },
        "predicate": { "@type": "Node",     "node": "rdf:type" },
        "object":    { "@type": "Node",     "node": "@schema:ListItem" }
      },
      {
        "@type": "Triple",
        "subject":   { "@type": "Variable", "name": "Doc" },
        "predicate": { "@type": "Node",     "node": "@schema:line1" },
        "object":    { "@type": "Variable", "name": "Line1" }
      },
      {
        "@type": "Regexp",
        "pattern": { "@type": "DataValue", "data": { "@type": "xsd:string", "@value": "(?i).*хлеб.*" } },
        "string":  { "@type": "Variable",  "name": "Line1" },
        "result":  { "@type": "Variable",  "name": "Match" }
      }
    ]
  }
}
```

`(?i).*<query>.*` — регистронезависимый поиск подстроки.

**Ответ `200 OK`:**
```json
{
  "bindings": [
    { "Doc": "ListItem/2",  "Line1": "Хлеб ржаной" },
    { "Doc": "ListItem/26", "Line1": "Бородинский" },
    { "Doc": "ListItem/27", "Line1": "Столичный"   }
  ]
}
```

---

### 4.3 Добавить элемент в корень

**Триггер:** кнопка `+` → модальное окно → «Добавить»

```http
POST /api/document/admin/searchmydata/local/branch/main
     ?graph_type=instance&author=user%40app&message=add+item+32
Content-Type: application/json
Authorization: Basic admin:<password>
```

```json
{
  "@type": "ListItem",
  "@id":   "ListItem/32",
  "line1": "Сахар",
  "line2": "1 кг, белый",
  "position": 25
}
```

**Ответ `200 OK`:**
```
TerminusDB-Data-Version: branch:main:hash:b3f9a21c
```

---

### 4.4 Добавить вложенный элемент

**Триггер:** свайп вправо → «Вложенный» → модальное окно → «Добавить»

```http
POST /api/document/admin/searchmydata/local/branch/main
     ?graph_type=instance&author=user%40app&message=add+child+to+2
Content-Type: application/json
Authorization: Basic admin:<password>
```

```json
{
  "@type":  "ListItem",
  "@id":    "ListItem/32",
  "line1":  "Нарезной",
  "line2":  "350 г",
  "position": 2,
  "parent": { "@id": "ListItem/2" }
}
```

---

### 4.5 Редактировать элемент

**Триггер:** свайп вправо → «Изменить» → модальное окно → «Сохранить»

Используется нативный TerminusDB-патч. `@op: "SwapValue"` требует явного указания старого значения — страница берёт его из текущего in-memory состояния.

```http
POST /api/patch/admin/searchmydata/local/branch/main
Content-Type: application/json
Authorization: Basic admin:<password>
```

```json
{
  "author":  "user@app",
  "message": "edit item 26",
  "patch": [
    {
      "@id":   "ListItem/26",
      "line1": { "@op": "SwapValue", "@before": "Бородинский", "@after": "Бородинский 400 г" },
      "line2": { "@op": "SwapValue", "@before": "400 г",       "@after": "600 г" }
    }
  ]
}
```

Если `line2` удаляется (поле очищено):
```json
"line2": { "@op": "SwapValue", "@before": "400 г", "@after": null }
```

**Ответ `200 OK`:**
```json
["ListItem/26"]
```
```
TerminusDB-Data-Version: branch:main:hash:c7d10e84
```

---

### 4.6 Удалить элемент

**Триггер:** свайп вправо → «Удалить»

Удаляет элемент и всех его потомков. Клиент собирает полный список ID поддерева из текущего состояния и отправляет их в одном запросе.

```http
DELETE /api/document/admin/searchmydata/local/branch/main
       ?graph_type=instance&author=user%40app&message=delete+item+10
Content-Type: application/json
Authorization: Basic admin:<password>
```

Тело запроса — JSON-массив ID для удаления:
```json
["ListItem/10"]
```

Если удаляется элемент с дочерними (напр. ListItem/2 с детьми 26, 27):
```json
["ListItem/2", "ListItem/26", "ListItem/27"]
```

**Ответ `200 OK`:**
```
TerminusDB-Data-Version: branch:main:hash:e1a5f3b2
```

---

### 4.7 Управление тегами

**Триггер:** свайп влево → панель тегов → выбрать тег

Доступный набор: `Важное`, `Срочно`, `Купить`, `Дом`, `Работа`, `Отложить`.
Повторный выбор тега снимает его.

**Добавить тег** (теги: `[]` → `["Срочно"]`):
```json
{
  "author":  "user@app",
  "message": "add tag Срочно to item 1",
  "patch": [
    {
      "@id":  "ListItem/1",
      "tags": {
        "@op":    "SwapValue",
        "@before": [],
        "@after":  ["Срочно"]
      }
    }
  ]
}
```

**Снять тег** (теги: `["Важное","Срочно"]` → `["Важное"]`):
```json
{
  "author":  "user@app",
  "message": "remove tag Срочно from item 1",
  "patch": [
    {
      "@id":  "ListItem/1",
      "tags": {
        "@op":     "SwapValue",
        "@before": ["Важное", "Срочно"],
        "@after":  ["Важное"]
      }
    }
  ]
}
```

Эндпоинт: `POST /api/patch/admin/searchmydata/local/branch/main`

---

### 4.8 Свернуть / развернуть узел

**Триггер:** касание / клик по элементу с дочерними элементами

**Свернуть** (`collapsed: false → true`):
```json
{
  "author":  "user@app",
  "message": "collapse item 2",
  "patch": [
    {
      "@id":      "ListItem/2",
      "collapsed": { "@op": "SwapValue", "@before": false, "@after": true }
    }
  ]
}
```

**Развернуть** (`collapsed: true → false`):
```json
{
  "author":  "user@app",
  "message": "expand item 2",
  "patch": [
    {
      "@id":      "ListItem/2",
      "collapsed": { "@op": "SwapValue", "@before": true, "@after": false }
    }
  ]
}
```

Если поле `collapsed` ещё не существует (`undefined → true`):
```json
"collapsed": { "@op": "SwapValue", "@before": null, "@after": true }
```

Эндпоинт: `POST /api/patch/admin/searchmydata/local/branch/main`

---

### 4.9 Перетащить элемент (изменить порядок)

**Триггер:** удерживать элемент ≥370 мс → перемещать вертикально → отпустить

Drag перестраивает порядок и, опционально, уровень вложенности (right-shift ≥36 пикселей углубляет элемент под соседний).

Один запрос содержит патч для всех изменившихся `position` и `parent`:

```http
POST /api/patch/admin/searchmydata/local/branch/main
Content-Type: application/json
Authorization: Basic admin:<password>
```

**Пример: ListItem/10 перемещён с позиции 2 на позицию 0, без смены родителя:**
```json
{
  "author":  "user@app",
  "message": "reorder: move item 10 to position 0",
  "patch": [
    {
      "@id":      "ListItem/10",
      "position": { "@op": "SwapValue", "@before": 2, "@after": 0 }
    },
    {
      "@id":      "ListItem/1",
      "position": { "@op": "SwapValue", "@before": 0, "@after": 1 }
    },
    {
      "@id":      "ListItem/2",
      "position": { "@op": "SwapValue", "@before": 1, "@after": 2 }
    }
  ]
}
```

**Пример: углубление (right-shift) — ListItem/4 становится дочерним ListItem/3:**
```json
{
  "author":  "user@app",
  "message": "reorder: nest item 4 under item 3",
  "patch": [
    {
      "@id":    "ListItem/4",
      "parent": { "@op": "SwapValue", "@before": null,         "@after": { "@id": "ListItem/3" } },
      "position": { "@op": "SwapValue", "@before": 3, "@after": 0 }
    }
  ]
}
```

---

### 4.10 Откат последнего действия

**Триггер:** кнопка `↩` в заголовке

Страница сохраняет `COMMIT_ID` предыдущего успешного действия в памяти.
При нажатии «Отменить» делается hard-reset ветки к тому коммиту.

```http
POST /api/reset/admin/searchmydata/local/branch/main
Content-Type: application/json
Authorization: Basic admin:<password>
```

```json
{
  "commit_descriptor": "admin/searchmydata/local/commit/c7d10e84"
}
```

**Ответ `200 OK`** — ветка `main` указывает на коммит `c7d10e84`.
После сброса страница повторно запрашивает `GET /api/document/...?type=ListItem` и перерисовывает список.

> **Undo depth:** страница хранит только один предыдущий коммит (аналогично текущей кнопке ↩).
> TerminusDB хранит полную историю — глубину отмены можно увеличить без изменения серверного API.

---

### 4.11 Просмотреть элемент

**Триггер:** свайп вправо → «Просмотр»

Данные уже в памяти браузера — отдельного запроса к серверу нет.

---

## 5. Получение истории коммитов

```http
GET /api/log/admin/searchmydata/local/branch/main?count=20
Authorization: Basic admin:<password>
```

**Ответ:**
```json
[
  { "commit": "e1a5f3b2", "author": "user@app", "message": "delete item 10",       "timestamp": "2026-05-29T12:05:00Z" },
  { "commit": "b3f9a21c", "author": "user@app", "message": "add item 32",          "timestamp": "2026-05-29T12:03:00Z" },
  { "commit": "c7d10e84", "author": "user@app", "message": "edit item 26",         "timestamp": "2026-05-29T12:01:00Z" },
  { "commit": "a0e2c519", "author": "admin",     "message": "initial data import", "timestamp": "2026-05-29T11:00:00Z" }
]
```

---

## 6. Тестовый воркфлоу

### Сценарий
Пользователь открывает список, ищет элемент, редактирует и добавляет данные, затем откатывает удаление.

### Начальное состояние документа

```json
[
  { "@id": "ListItem/1",  "line1": "Молоко 3.2%", "line2": "2 пакета",     "position": 0 },
  { "@id": "ListItem/2",  "line1": "Хлеб ржаной",                          "position": 1 },
  { "@id": "ListItem/26", "line1": "Бородинский",  "line2": "400 г",        "position": 0, "parent": {"@id": "ListItem/2"} },
  { "@id": "ListItem/27", "line1": "Столичный",    "line2": "500 г",        "position": 1, "parent": {"@id": "ListItem/2"} },
  { "@id": "ListItem/10", "line1": "Яйца",         "line2": "10 штук, C1", "position": 2 },
  { "@id": "ListItem/4",  "line1": "Кофе",         "line2": "Арабика, 250 г","position": 3 }
]
```

---

### Лог API

---

#### Шаг 1 — Загрузка документа при открытии страницы

**Запрос:**
```
GET /api/document/admin/searchmydata/local/branch/main
    ?type=ListItem&as_list=true&unfold=false
Authorization: Basic admin:root
```

**Ответ `200 OK`:**
```json
[
  { "@type": "ListItem", "@id": "ListItem/1",  "line1": "Молоко 3.2%",  "line2": "2 пакета",      "position": 0 },
  { "@type": "ListItem", "@id": "ListItem/2",  "line1": "Хлеб ржаной",                             "position": 1 },
  { "@type": "ListItem", "@id": "ListItem/26", "line1": "Бородинский",  "line2": "400 г",          "position": 0, "parent": {"@id": "ListItem/2"} },
  { "@type": "ListItem", "@id": "ListItem/27", "line1": "Столичный",    "line2": "500 г",          "position": 1, "parent": {"@id": "ListItem/2"} },
  { "@type": "ListItem", "@id": "ListItem/10", "line1": "Яйца",         "line2": "10 штук, C1",   "position": 2 },
  { "@type": "ListItem", "@id": "ListItem/4",  "line1": "Кофе",         "line2": "Арабика, 250 г", "position": 3 }
]
```
```
TerminusDB-Data-Version: branch:main:hash:a0e2c519
```
*Страница сохраняет: `prev_commit = null`, `curr_commit = a0e2c519`*

---

#### Шаг 2 — Поиск: пользователь вводит «хлеб»

**Запрос:**
```
POST /api/woql/admin/searchmydata/local/branch/main
Content-Type: application/json
Authorization: Basic admin:root
```
```json
{
  "query": {
    "@type": "And",
    "and": [
      { "@type": "Triple",
        "subject":   {"@type": "Variable", "name": "Doc"},
        "predicate": {"@type": "Node",     "node": "rdf:type"},
        "object":    {"@type": "Node",     "node": "@schema:ListItem"} },
      { "@type": "Triple",
        "subject":   {"@type": "Variable", "name": "Doc"},
        "predicate": {"@type": "Node",     "node": "@schema:line1"},
        "object":    {"@type": "Variable", "name": "Line1"} },
      { "@type": "Regexp",
        "pattern": {"@type": "DataValue", "data": {"@type": "xsd:string", "@value": "(?i).*хлеб.*"}},
        "string":  {"@type": "Variable", "name": "Line1"},
        "result":  {"@type": "Variable", "name": "Match"} }
    ]
  }
}
```

**Ответ `200 OK`:**
```json
{
  "bindings": [
    {"Doc": "ListItem/2",  "Line1": "Хлеб ржаной"},
    {"Doc": "ListItem/26", "Line1": "Бородинский"},
    {"Doc": "ListItem/27", "Line1": "Столичный"}
  ]
}
```
*Страница подсвечивает совпадающие элементы. Документ не изменяется.*

---

#### Шаг 3 — Редактирование: ListItem/26 «Бородинский» → «400 г» меняется на «600 г»

**Запрос:**
```
POST /api/patch/admin/searchmydata/local/branch/main
Content-Type: application/json
Authorization: Basic admin:root
```
```json
{
  "author":  "user@app",
  "message": "edit item 26: line2 400г -> 600г",
  "patch": [
    {
      "@id":  "ListItem/26",
      "line2": {"@op": "SwapValue", "@before": "400 г", "@after": "600 г"}
    }
  ]
}
```

**Ответ `200 OK`:**
```json
["ListItem/26"]
```
```
TerminusDB-Data-Version: branch:main:hash:c7d10e84
```
*Страница сохраняет: `prev_commit = a0e2c519`, `curr_commit = c7d10e84`. Кнопка ↩ становится активной.*

---

#### Шаг 4 — Добавление нового элемента «Сахар»

**Запрос:**
```
POST /api/document/admin/searchmydata/local/branch/main
     ?graph_type=instance&author=user%40app&message=add+item+32
Content-Type: application/json
Authorization: Basic admin:root
```
```json
{
  "@type":   "ListItem",
  "@id":     "ListItem/32",
  "line1":   "Сахар",
  "line2":   "1 кг, белый",
  "position": 4
}
```

**Ответ `200 OK`:**
```
TerminusDB-Data-Version: branch:main:hash:b3f9a21c
```
*Страница сохраняет: `prev_commit = c7d10e84`, `curr_commit = b3f9a21c`*

---

#### Шаг 5 — Удаление: пользователь удаляет «Яйца» (ListItem/10)

**Запрос:**
```
DELETE /api/document/admin/searchmydata/local/branch/main
       ?graph_type=instance&author=user%40app&message=delete+item+10
Content-Type: application/json
Authorization: Basic admin:root
```
```json
["ListItem/10"]
```

**Ответ `200 OK`:**
```
TerminusDB-Data-Version: branch:main:hash:e1a5f3b2
```
*Страница сохраняет: `prev_commit = b3f9a21c`, `curr_commit = e1a5f3b2`*

---

#### Шаг 6 — Откат: пользователь нажимает ↩ (отменяет удаление)

Страница делает reset к `prev_commit = b3f9a21c`.

**Запрос:**
```
POST /api/reset/admin/searchmydata/local/branch/main
Content-Type: application/json
Authorization: Basic admin:root
```
```json
{
  "commit_descriptor": "admin/searchmydata/local/commit/b3f9a21c"
}
```

**Ответ `200 OK`**

Страница повторно загружает список:
```
GET /api/document/admin/searchmydata/local/branch/main
    ?type=ListItem&as_list=true&unfold=false
```

**Ответ `200 OK`:**
```json
[
  { "@type": "ListItem", "@id": "ListItem/1",  "line1": "Молоко 3.2%",   "line2": "2 пакета",      "position": 0 },
  { "@type": "ListItem", "@id": "ListItem/2",  "line1": "Хлеб ржаной",                              "position": 1 },
  { "@type": "ListItem", "@id": "ListItem/26", "line1": "Бородинский",   "line2": "600 г",          "position": 0, "parent": {"@id": "ListItem/2"} },
  { "@type": "ListItem", "@id": "ListItem/27", "line1": "Столичный",     "line2": "500 г",          "position": 1, "parent": {"@id": "ListItem/2"} },
  { "@type": "ListItem", "@id": "ListItem/10", "line1": "Яйца",          "line2": "10 штук, C1",   "position": 2 },
  { "@type": "ListItem", "@id": "ListItem/4",  "line1": "Кофе",          "line2": "Арабика, 250 г", "position": 3 },
  { "@type": "ListItem", "@id": "ListItem/32", "line1": "Сахар",         "line2": "1 кг, белый",   "position": 4 }
]
```
```
TerminusDB-Data-Version: branch:main:hash:b3f9a21c
```
*Кнопка ↩ деактивируется. `prev_commit = null`, `curr_commit = b3f9a21c`*

---

### Конечное состояние документа

| @id | line1 | line2 | position | parent |
|-----|-------|-------|----------|--------|
| ListItem/1 | Молоко 3.2% | 2 пакета | 0 | — |
| ListItem/2 | Хлеб ржаной | — | 1 | — |
| ListItem/26 | Бородинский | **600 г** ← изменено | 0 | ListItem/2 |
| ListItem/27 | Столичный | 500 г | 1 | ListItem/2 |
| ListItem/10 | Яйца | 10 штук, C1 | 2 | — |
| ListItem/4 | Кофе | Арабика, 250 г | 3 | — |
| ListItem/32 | **Сахар** ← добавлено | 1 кг, белый | 4 | — |

**Изменения относительно начального состояния:**
- `ListItem/26.line2`: `"400 г"` → `"600 г"` (шаг 3, сохранено)
- `ListItem/32`: добавлен «Сахар» (шаг 4, сохранено)
- `ListItem/10`: удалён на шаге 5, **восстановлен откатом на шаге 6**

---

## Источники

- [TerminusDB HTTP Documents API](https://terminusdb.org/docs/document-insertion/)
- [TerminusDB JSON Diff and Patch](https://terminusdb.org/docs/json-diff-and-patch/)
- [TerminusDB OpenAPI spec](https://raw.githubusercontent.com/terminusdb/terminusdb/main/docs/openapi.yaml)
- [WOQL Filtering](https://terminusdb.com/docs/filter-with-woql/)
- [Reset to a Commit (Python Client)](https://terminusdb.com/docs/reset-to-a-commit-with-python/)
