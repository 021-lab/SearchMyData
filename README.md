# Workspace — иерархический менеджер задач

Веб-интерфейс для управления задачами с Git-бэкендом.  
Каждое изменение — отдельный git-коммит. История не удаляется.

---

## Быстрый старт

```bash
git clone https://github.com/021-lab/SearchMyData.git
cd SearchMyData
pip install -r requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Открыть в браузере:

```
http://localhost:8000/list-manager.html
```

> **Фронт и бэк — один сервер, один порт.**  
> FastAPI сам отдаёт `list-manager.html` и все статические файлы.  
> Отдельный веб-сервер не нужен.

---

## Что в репозитории

```
SearchMyData/
│
├── list-manager.html      ← интерфейс (открывать через :8000)
├── list-manager.css
├── api.js                 ← API-клиент фронтенда
├── list-data.js           ← данные-заглушка (офлайн-режим)
│
├── backend/
│   ├── main.py            ← FastAPI: отдаёт фронт + обрабатывает API
│   ├── git_store.py       ← хранение данных в git
│   ├── id_gen.py          ← генерация ID (Base62)
│   ├── patch_ops.py       ← JSON Patch (RFC 6902), поиск, удаление
│   └── models.py          ← Pydantic-модели
│
└── requirements.txt
```

Папка `data/` создаётся автоматически при первом запуске.  
Там хранится `project_tree.json` и его git-история.

---

## Деплой на сервер

Подробная инструкция с systemd и nginx: [DEPLOY.md](DEPLOY.md)
