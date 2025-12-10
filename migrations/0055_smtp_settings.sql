CREATE TABLE IF NOT EXISTS smtp_settings (
    id varchar PRIMARY KEY DEFAULT 'smtp_singleton',
    host varchar(255) NOT NULL,
    port integer NOT NULL,
    use_tls boolean NOT NULL DEFAULT false,
    use_ssl boolean NOT NULL DEFAULT false,
    username varchar(255),
    password varchar(255),
    from_email varchar(255) NOT NULL,
    from_name varchar(255),
    updated_by_admin_id varchar REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
