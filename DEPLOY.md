# Развёртывание Git-as-Backend Workspace

## Требования

| Компонент | Версия |
|-----------|--------|
| Python    | 3.10 + |
| git       | 2.30 + |
| pip       | любая  |

---

## 1. Клонировать репозиторий

```bash
git clone https://github.com/021-lab/SearchMyData.git
cd SearchMyData
```

---

## 2. Установить зависимости

```bash
pip install -r backend/requirements.txt
```

---

## 3. Запустить сервер

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Открыть в браузере:

```
http://<IP-сервера>:8000/list-manager.html
```

---

## 4. Продакшн: systemd-сервис (автозапуск)

Создать файл `/etc/systemd/system/workspace.service`:

```ini
[Unit]
Description=Workspace Git-as-Backend
After=network.target

[Service]
WorkingDirectory=/opt/SearchMyData
ExecStart=/usr/bin/python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Включить и запустить:

```bash
sudo cp -r . /opt/SearchMyData
sudo systemctl daemon-reload
sudo systemctl enable workspace
sudo systemctl start workspace
```

---

## 5. Продакшн: nginx + домен (опционально)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/workspace /etc/nginx/sites-enabled/
sudo nginx -s reload
```

---

## Структура проекта

```
SearchMyData/
├── backend/
│   ├── main.py          # FastAPI — 3 endpoint-а
│   ├── git_store.py     # Git-хранилище данных
│   ├── id_gen.py        # Base62 генерация ID
│   ├── patch_ops.py     # RFC 6902 JSON Patch
│   ├── models.py        # Pydantic модели
│   └── requirements.txt
├── data/                # Создаётся автоматически при первом запуске
│   └── project_tree.json
├── api.js               # Фронтенд API-клиент
├── list-manager.html    # Интерфейс
└── list-manager.css
```

> **data/** — отдельный git-репозиторий для данных.  
> Создаётся автоматически при первом старте сервера.  
> Каждое изменение = отдельный git-коммит с именем автора.

---

## API

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/tasks/search` | Поиск задач, вернуть поддерево |
| POST | `/api/tasks/action` | Мутация (`add_node` / `patch` / `reorder`) |
| POST | `/api/tasks/undo` | Откатить последний коммит (`git revert`) |

---

## Данные

Все задачи хранятся в `data/project_tree.json`.  
История изменений — в `git -C data log`.

```bash
# Посмотреть историю изменений
git -C data log --format="%ai %an | %s"
```
