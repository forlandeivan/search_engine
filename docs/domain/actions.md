# Actions & SkillActions (спецификация)

## Зачем
- **Action** — описание действия над текстом (промпт + метаданные), применимого к стенограмме, сообщению или выделенному фрагменту. Действия бывают глобальные (system) и кастомные для конкретного workspace.
- **SkillAction** — связь действия с конкретным навыком (Skill) и настройка, где и как оно показывается в UI для этого навыка.

> На этом этапе только спецификация моделей и схема БД. Реализация по умолчанию будет создавать workspace‑действия, но модель поддерживает и глобальные system‑actions.

## Action
| Поле | Тип | Описание |
| --- | --- | --- |
| id | string (UUID) | Идентификатор действия |
| scope | ActionScope | `system` — глобальное; `workspace` — принадлежит workspace |
| workspaceId | string &#124; null | Для `scope=workspace` — обязательный id workspace; для `system` — `null` |
| label | string | Короткое имя для UI (кнопка/меню) |
| description | string &#124; null | Подсказка/описание для ховера/настроек |
| target | ActionTarget | Над чем работает: `transcript` \| `message` \| `selection` \| `conversation` |
| placements | ActionPlacement[] | Где **может** появляться (superset): `canvas`, `chat_message`, `chat_toolbar` |
| promptTemplate | string | Шаблон промпта с плейсхолдерами (например, `{{text}}`, `{{language}}`) |
| inputType | ActionInputType | Как брать текст: `full_transcript` \| `selection` |
| outputMode | ActionOutputMode | Что делать с результатом: `replace_text` \| `new_version` \| `new_message` \| `document` |
| llmConfigId | string | Ссылка на LLM-конфиг (модель, температура и т.п.) |
| createdAt / updatedAt | timestamp | Технические поля |
| deletedAt | timestamp &#124; null | Soft delete при необходимости |

Примечание: `target=selection` подразумевает, что действию нужен выделенный фрагмент; `inputType` задаёт, берём ли весь текст или именно выделение.

## SkillAction
| Поле | Тип | Описание |
| --- | --- | --- |
| id | string (UUID) | Идентификатор |
| skillId | string | Ссылка на навык |
| actionId | string | Ссылка на действие |
| enabled | boolean | Включено ли действие в этом навыке |
| enabledPlacements | ActionPlacement[] | Подмножество `Action.placements`, где действие реально показывается в этом навыке |
| labelOverride | string &#124; null | Переопределение label для этого навыка (опционально) |
| createdAt / updatedAt | timestamp | Технические поля |

## Enums
- **ActionScope**: `system` | `workspace`
- **ActionTarget**: `transcript` | `message` | `selection` | `conversation`
- **ActionPlacement**: `canvas` | `chat_message` | `chat_toolbar`
- **ActionInputType**: `full_transcript` | `selection`
- **ActionOutputMode**: `replace_text` | `new_version` | `new_message` | `document`

## Инварианты / правила
- Для `Action.scope = workspace` → `Action.workspaceId` обязателен и должен совпадать с workspace навыка, если действие подключено через SkillAction.
- Для `Action.scope = system` → `Action.workspaceId = null`; такие действия можно подключать в любом workspace через SkillAction.
- `SkillAction.enabledPlacements` ⊆ `Action.placements` (в навыке нельзя включить размещение, которого нет у исходного действия).
- `SkillAction` не может ссылаться на `Action` из чужого workspace (для workspace‑действий).
- Сейчас создаём только workspace‑действия, но типы поддерживают оба scope.

## Связь target и inputType
- `target = selection` ожидает выделенный текст; `inputType = selection` фиксирует, что в промпт идёт именно выделение.
- `target = transcript` / `message` может использовать `inputType = full_transcript` или `selection` (если UI позволяет выделение).

## Схема БД
- Таблица: `actions`
- Основные поля: id, scope, workspace_id, label, description, target, placements[], prompt_template, input_type, output_mode, llm_config_id, created_at, updated_at, deleted_at.
- Ограничение: scope=system → workspace_id NULL; scope=workspace → workspace_id NOT NULL.
- Таблица связи: `skill_actions` — skill_id, action_id, enabled, enabled_placements[], label_override, created_at, updated_at; UNIQUE(skill_id, action_id).

***
