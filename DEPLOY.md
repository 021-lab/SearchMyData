# Развёртывание Workspace

## Архитектура

```
Браузер пользователя
       │
       ▼
  [ Один сервер ]
  ┌─────────────────────────────────────┐
  │  uvicorn  :8000                     │
  │                                     │
  │  /api/tasks/*  →  FastAPI-бэкенд   │
  │  /*            →  Статика фронта    │
  │    list-manager.html                │
  │    list-manager.css                 │
  │    api.js                           │
  │                                     │
  │  data/  ← git-репозиторий данных   │
  └─────────────────────────────────────┘
```

**Фронт и бэк — один процесс, один порт.**  
FastAPI сам отдаёт HTML/CSS/JS и обрабатывает API-запросы.  
Отдельный веб-сервер для фронта не нужен.

---

## Требования

| Компонент | Версия |
|-----------|--------|
| Python    | 3.10 + |
| git       | 2.30 + |

---

## Быстрый старт (3 команды)

```bash
git clone https://github.com/021-lab/SearchMyData.git
cd SearchMyData
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Открыть в браузере: `http://<IP>:8000/list-manager.html`

Папка `data/` с git-репозиторием данных создаётся автоматически при первом запуске.

---

## Продакшн: автозапуск через systemd

```bash
# Скопировать проект
sudo cp -r . /opt/workspace
```

Создать `/etc/systemd/system/workspace.service`:

```ini
[Unit]
Description=Workspace
After=network.target

[Service]
WorkingDirectory=/opt/workspace
ExecStart=/usr/bin/python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now workspace

# Проверить статус
sudo systemctl status workspace
```

---

## Продакшн: nginx + домен + HTTPS (опционально)

Если нужен домен и SSL вместо голого порта 8000:

```nginx
# /etc/nginx/sites-available/workspace
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/workspace /etc/nginx/sites-enabled/
sudo nginx -s reload

# SSL через certbot
sudo certbot --nginx -d your-domain.com
```

После этого сервис доступен по `https://your-domain.com/list-manager.html`.

---

## Структура файлов

```
SearchMyData/
│
├── backend/               # Python-бэкенд
│   ├── main.py            # FastAPI: API + раздача фронта
│   ├── git_store.py       # Git-хранилище данных
│   ├── id_gen.py          # Генерация ID (Base62)
│   ├── patch_ops.py       # RFC 6902 JSON Patch, поиск
│   ├── models.py          # Pydantic-модели запросов
│   └── requirements.txt
│
├── list-manager.html      # ← Фронтенд (отдаётся бэком)
├── list-manager.css       # ← Фронтенд (отдаётся бэком)
├── api.js                 # ← Фронтенд (отдаётся бэком)
│
└── data/                  # Создаётся автоматически
    ├── .git/              # git-история всех изменений
    └── project_tree.json  # Данные задач
```

---

## API-эндпоинты

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/tasks/search` | Поиск задач, возвращает поддерево |
| POST | `/api/tasks/action` | Мутация: `add_node` / `patch` / `reorder` |
| POST | `/api/tasks/undo`   | Откат последнего коммита (`git revert`) |
| GET  | `/*`               | Статика фронтенда |

---

## Данные и история

```bash
# Все изменения хранятся как git-коммиты
git -C data log --format="%ai  %an  |  %s"

# Посмотреть текущее состояние
cat data/project_tree.json
```
