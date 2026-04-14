# Voice API Contract

## POST /voice

Принимает голосовое сообщение. Запрос валиден если передано хотя бы одно поле.

---

### Запрос

```
Content-Type: multipart/form-data
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `audio` | file | нет | Аудиофайл `audio/webm` или `audio/ogg`. Имя: `voice_<unix_ms>.<ext>` |
| `context` | string | нет | Произвольный текстовый контекст |
| `user_id` | string | нет | Идентификатор пользователя |

> Запрос отклоняется если все три поля отсутствуют.

---

### Ответы

**`200 OK`** — принято

```json
{ "ok": true }
```

**`400 Bad Request`** — нет ни одного поля

```json
{ "ok": false, "error": "at least one field required" }
```

**`500 Internal Server Error`** — ошибка сервера

```json
{ "ok": false, "error": "описание ошибки" }
```

---

### Заголовки сервера

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
```

---

### Примеры

Только аудио:
```
audio=<file>
```

Аудио с контекстом:
```
audio=<file>
context=список покупок
```

Только текст (без аудио):
```
context=добавить молоко
user_id=user_42
```
