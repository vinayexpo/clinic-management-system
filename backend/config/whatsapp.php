<?php

return [

    /*
    |---------------------------------------------------------------------------
    | WhatsApp Business Cloud API
    |---------------------------------------------------------------------------
    |
    | Reminders are business-initiated messages, so WhatsApp requires an approved
    | message template. Each event below maps to a template approved in the Meta
    | template manager. The template body stored in the database is rendered to
    | fill the template parameters.
    |
    */

    'enabled' => env('WHATSAPP_ENABLED', false),

    /**
     * When true, messages are rendered and logged but never sent to WhatsApp.
     * Use it to verify templates before connecting a real business number.
     */
    'log_only' => env('WHATSAPP_LOG_ONLY', true),

    'phone_number_id' => env('WHATSAPP_PHONE_NUMBER_ID'),

    /** Display number for the standard sender, shown in the settings screen. */
    'phone_number' => env('WHATSAPP_PHONE_NUMBER'),

    'access_token' => env('WHATSAPP_ACCESS_TOKEN'),

    'business_account_id' => env('WHATSAPP_BUSINESS_ACCOUNT_ID'),

    'app_id' => env('WHATSAPP_META_APP_ID'),
    'app_secret' => env('WHATSAPP_META_APP_SECRET'),
    // Use a new Facebook Login for Business configuration with Embedded Signup v4.
    'signup_config_id' => env('WHATSAPP_SIGNUP_CONFIG_ID'),
    'webhook_verify_token' => env('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
    // Set only after Meta has verified the public callback and required webhook fields.
    'coexistence_ready' => env('WHATSAPP_COEXISTENCE_READY', false),

    'graph_version' => env('WHATSAPP_GRAPH_VERSION', 'v26.0'),

    'api_base' => env('WHATSAPP_API_BASE', 'https://graph.facebook.com'),

    /** Default country code used to build E.164 numbers from a local phone number. */
    'country_code' => env('WHATSAPP_COUNTRY_CODE', '91'),

    /** Default language code sent with the template. */
    'language' => env('WHATSAPP_LANGUAGE', 'en'),

    /** HTTP timeout in seconds for a single send. */
    'timeout' => (int) env('WHATSAPP_TIMEOUT', 10),

    /**
     * How many hours before an appointment the automatic reminder is sent.
     */
    'reminder_lead_hours' => (int) env('WHATSAPP_REMINDER_LEAD_HOURS', 24),

    /** How far ahead the scheduler looks for appointments to remind. */
    'reminder_lookahead_hours' => (int) env('WHATSAPP_REMINDER_LOOKAHEAD_HOURS', 26),

    /**
     * Skip reminders for appointments that fall outside the doctor's working
     * hours, when the doctor has a schedule configured.
     */
    'respect_doctor_schedule' => env('WHATSAPP_RESPECT_DOCTOR_SCHEDULE', true),

    /** Send messages through the queue instead of during the request. */
    'queue' => env('WHATSAPP_QUEUE', false),

    /**
     * Default template definitions. The body may contain {{placeholders}};
     * their values are sent as WhatsApp template parameters in order of appearance.
     */
    'default_templates' => [
        'appointment_confirmation' => [
            'name' => 'carehaven_appointment_confirmation',
            'body' => 'Hello {{patient_name}}, your appointment with {{doctor_name}} is confirmed for {{appointment_date}} at {{appointment_time}}. Reason: {{reason}}.',
        ],
        'appointment_reminder' => [
            'name' => 'carehaven_appointment_reminder',
            'body' => 'Reminder: {{patient_name}}, you have an appointment with {{doctor_name}} on {{appointment_date}} at {{appointment_time}}.',
        ],
        'appointment_cancelled' => [
            'name' => 'carehaven_appointment_cancelled',
            'body' => 'Hello {{patient_name}}, your appointment on {{appointment_date}} at {{appointment_time}} has been cancelled. Reason: {{reason}}.',
        ],
        'appointment_rescheduled' => [
            'name' => 'carehaven_appointment_rescheduled',
            'body' => 'Hello {{patient_name}}, your appointment has moved to {{appointment_date}} at {{appointment_time}} with {{doctor_name}}.',
        ],
        'prescription_ready' => [
            'name' => 'carehaven_prescription_ready',
            'body' => 'Hello {{patient_name}}, {{doctor_name}} has finalised your prescription. You can view it at {{portal_link}}.',
        ],
        'payment_receipt' => [
            'name' => 'carehaven_payment_receipt',
            'body' => 'Hello {{patient_name}}, we received {{amount}} against invoice {{invoice_number}}. Thank you.',
        ],
        'manual' => [
            'name' => 'carehaven_manual_message',
            'body' => 'Hello {{patient_name}}, a message from {{clinic_name}}: {{message}}',
        ],
    ],

];
