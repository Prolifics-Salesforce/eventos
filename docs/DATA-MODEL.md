# Data model

Generated from `src/db/schema.ts`. One database per instance; no tenant column. Tables prefixed `sys_` are the platform; the rest are business records, each carrying the shared system fields `sys_id`, `sys_created_at`, `sys_created_by`, `sys_updated_at`, `sys_updated_by` and `custom`.

## account

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| name | text | yes |  |
| domain | text |  |  |
| industry | text |  |  |

## budget_item

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| event_id | uuid | yes |  |
| label | text | yes |  |
| category | text |  |  |
| planned | integer | yes | 0 |
| actual | integer |  |  |

Links to: event

## contact

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| first_name | text | yes |  |
| last_name | text |  |  |
| email | text | yes |  |
| phone | text |  |  |
| title | text |  |  |
| account_id | uuid |  |  |
| email_opt_out_at | timestamp with time zone |  |  |
| whatsapp_opt_in_at | timestamp with time zone |  |  |

Links to: account

## event

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| number | text | yes |  |
| name | text | yes |  |
| slug | text | yes |  |
| kind | text | yes |  |
| status | text | yes | draft |
| starts_at | timestamp with time zone |  |  |
| ends_at | timestamp with time zone |  |  |
| timezone | text | yes | Asia/Kolkata |
| venue | text |  |  |
| brief | text |  |  |
| capacity | integer |  |  |
| target_registrations | integer |  |  |
| target_leads | integer |  |  |
| currency | text | yes | INR |
| description | text |  |  |
| cover_image_url | text |  |  |
| location_url | text |  |  |
| require_approval | boolean | yes | false |
| host_name | text |  |  |
| confirmation_note | text |  |  |
| reminders | boolean | yes | true |
| feedback_email | boolean | yes | false |

## event_session

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| event_id | uuid | yes |  |
| title | text | yes |  |
| abstract | text |  |  |
| track | text |  |  |
| room | text |  |  |
| starts_at | timestamp with time zone |  |  |
| ends_at | timestamp with time zone |  |  |
| capacity | integer |  |  |

Links to: event

## form_field

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| event_id | uuid | yes |  |
| purpose | text | yes |  |
| key | text | yes |  |
| label | text | yes |  |
| type | text | yes | text |
| options | jsonb | yes | set by database |
| required | boolean | yes | false |
| position | integer | yes | 0 |

Links to: event

## lead

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| number | text | yes |  |
| event_id | uuid | yes |  |
| contact_id | uuid | yes |  |
| captured_by | uuid |  |  |
| notes | text |  |  |
| answers | jsonb | yes | set by database |
| score | integer |  |  |
| band | text |  |  |
| pipeline_value | integer |  |  |

Links to: event, contact

## registration

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| number | text | yes |  |
| event_id | uuid | yes |  |
| contact_id | uuid | yes |  |
| status | text | yes | registered |
| source | text |  |  |
| pin | text |  |  |
| checked_in_at | timestamp with time zone |  |  |
| checked_in_by | uuid |  |  |

Links to: event, contact

## session_speaker

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| session_id | uuid | yes |  |
| contact_id | uuid | yes |  |
| role | text | yes | speaker |

Links to: event_session, contact

## survey_response

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| event_id | uuid | yes |  |
| registration_id | uuid | yes |  |
| score | integer | yes |  |
| comment | text |  |  |

Links to: event

## sys_api_key

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| user_id | uuid | yes |  |
| name | text | yes |  |
| hash | text | yes |  |
| revoked_at | timestamp with time zone |  |  |
| sys_created_at | timestamp with time zone | yes | set by database |

Links to: sys_user

## sys_audit

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| id (key) | bigserial | yes | set by database |
| at | timestamp with time zone | yes | set by database |
| actor_id | uuid | yes |  |
| actor_kind | text | yes |  |
| approved_by | uuid |  |  |
| tool | text | yes |  |
| status | text | yes |  |
| input | jsonb |  |  |
| result | jsonb |  |  |
| error | text |  |  |
| run_id | uuid |  |  |

## sys_dictionary

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| table_name | text | yes |  |
| column_name | text | yes |  |
| label | text | yes |  |
| type | text | yes | string |
| choices | jsonb |  |  |
| is_custom | boolean | yes | true |

## sys_event

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| id (key) | bigserial | yes | set by database |
| name | text | yes |  |
| payload | jsonb | yes | set by database |
| actor_id | uuid |  |  |
| at | timestamp with time zone | yes | set by database |
| processed_at | timestamp with time zone |  |  |
| attempts | integer | yes | 0 |
| last_error | text |  |  |

## sys_journal

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| id (key) | bigserial | yes | set by database |
| table_name | text | yes |  |
| record_id | uuid | yes |  |
| author_id | uuid |  |  |
| kind | text | yes | work_note |
| body | text | yes |  |
| at | timestamp with time zone | yes | set by database |

## sys_number

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| prefix (key) | text | yes |  |
| next | integer | yes | 1 |

## sys_outbox

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| channel | text | yes |  |
| recipient | text | yes |  |
| subject | text |  |  |
| body | text | yes |  |
| meta | jsonb | yes | set by database |
| contact_id | uuid |  |  |
| event_id | uuid |  |  |
| status | text | yes | pending |
| attempts | integer | yes | 0 |
| next_attempt_at | timestamp with time zone | yes | set by database |
| locked_at | timestamp with time zone |  |  |
| sent_at | timestamp with time zone |  |  |
| last_error | text |  |  |
| dedupe_key | text |  |  |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |

## sys_policy

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| user_id | uuid |  |  |
| tool | text | yes | * |
| level | text | yes |  |
| daily_cap | integer |  |  |

Links to: sys_user

## sys_property

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| key (key) | text | yes |  |
| value | text | yes |  |
| sys_created_at | timestamp with time zone | yes | set by database |

## sys_role

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| name | text | yes |  |
| permissions | jsonb | yes | set by database |

## sys_session

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| user_id | uuid | yes |  |
| token_hash | text | yes |  |
| expires_at | timestamp with time zone | yes |  |
| sys_created_at | timestamp with time zone | yes | set by database |

Links to: sys_user

## sys_user

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| kind | text | yes | human |
| name | text | yes |  |
| email | text |  |  |
| password_hash | text |  |  |
| active | boolean | yes | true |
| sys_created_at | timestamp with time zone | yes | set by database |

## sys_user_role

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| user_id | uuid | yes |  |
| role_id | uuid | yes |  |

Links to: sys_user, sys_role

## task

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| number | text | yes |  |
| task_type | text | yes | task |
| short_description | text | yes |  |
| description | text |  |  |
| state | text | yes | open |
| priority | integer | yes | 3 |
| assigned_to | uuid |  |  |
| event_id | uuid |  |  |
| parent_id | uuid |  |  |
| due_at | timestamp with time zone |  |  |
| payload | jsonb | yes | set by database |
| closed_at | timestamp with time zone |  |  |
| closed_by | uuid |  |  |

Links to: event

## webhook

| Column | Type | Required | Default |
| --- | --- | --- | --- |
| sys_id (key) | uuid | yes | set by database |
| sys_created_at | timestamp with time zone | yes | set by database |
| sys_created_by | uuid |  |  |
| sys_updated_at | timestamp with time zone | yes | set by database |
| sys_updated_by | uuid |  |  |
| custom | jsonb | yes | set by database |
| url | text | yes |  |
| secret | text | yes |  |
| events | jsonb | yes | set by database |
| active | boolean | yes | true |
