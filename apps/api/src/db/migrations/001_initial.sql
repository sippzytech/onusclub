CREATE TABLE merchants (
  id                      VARCHAR(36) PRIMARY KEY,
  business_name           VARCHAR(200) NOT NULL,
  owner_email             VARCHAR(200) NOT NULL UNIQUE,
  owner_phone             VARCHAR(20),
  country                 VARCHAR(2) DEFAULT 'NL',
  timezone                VARCHAR(50) DEFAULT 'Europe/Amsterdam',
  brand_color             VARCHAR(7) DEFAULT '#000000',
  logo_url                VARCHAR(500),
  hero_url                VARCHAR(500),
  google_place_id         VARCHAR(200),
  google_reviews_enabled  BOOLEAN DEFAULT FALSE,
  status                  ENUM('active','suspended','trial') DEFAULT 'trial',
  google_wallet_class_id  VARCHAR(200),
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE locations (
  id            VARCHAR(36) PRIMARY KEY,
  merchant_id   VARCHAR(36) NOT NULL,
  name          VARCHAR(200) NOT NULL,
  address       VARCHAR(500),
  latitude      DECIMAL(10,7),
  longitude     DECIMAL(10,7),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  INDEX (merchant_id)
);

CREATE TABLE loyalty_programs (
  id              VARCHAR(36) PRIMARY KEY,
  merchant_id     VARCHAR(36) NOT NULL,
  name            VARCHAR(200) NOT NULL,
  program_type    ENUM('stamp','points','membership','multipass','discount',
                       'cashback','gift','coupon') NOT NULL DEFAULT 'stamp',
  config_json     JSON NOT NULL,
  reward_text     VARCHAR(500) NOT NULL,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
);

CREATE TABLE customers (
  id           VARCHAR(36) PRIMARY KEY,
  merchant_id  VARCHAR(36) NOT NULL,
  phone        VARCHAR(20),
  email        VARCHAR(200),
  name         VARCHAR(200),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  INDEX (merchant_id, phone),
  INDEX (merchant_id, email)
);

CREATE TABLE loyalty_cards (
  id                       VARCHAR(36) PRIMARY KEY,
  merchant_id              VARCHAR(36) NOT NULL,
  customer_id              VARCHAR(36) NOT NULL,
  program_id               VARCHAR(36) NOT NULL,
  card_state               JSON NOT NULL,
  google_wallet_object_id  VARCHAR(200) UNIQUE,
  apple_pass_serial        VARCHAR(200) UNIQUE,
  qr_token                 VARCHAR(64) UNIQUE NOT NULL,
  status                   ENUM('active','blocked') DEFAULT 'active',
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_event_at            TIMESTAMP NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (program_id)  REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  INDEX (merchant_id, customer_id)
);

CREATE TABLE card_events (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  merchant_id   VARCHAR(36) NOT NULL,
  card_id       VARCHAR(36) NOT NULL,
  location_id   VARCHAR(36),
  staff_user_id VARCHAR(36),
  event_type    ENUM('stamp','redeem','reset','manual_adjust','points_add',
                     'review_reward','signup','expire') NOT NULL,
  delta_json    JSON,
  note          VARCHAR(500),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (card_id) REFERENCES loyalty_cards(id) ON DELETE CASCADE,
  INDEX (merchant_id, created_at),
  INDEX (card_id)
);

CREATE TABLE staff_users (
  id           VARCHAR(36) PRIMARY KEY,
  merchant_id  VARCHAR(36) NOT NULL,
  email        VARCHAR(200) NOT NULL UNIQUE,
  name         VARCHAR(200),
  role         ENUM('owner','staff') DEFAULT 'staff',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
);

CREATE TABLE auth_tokens (
  token        VARCHAR(64) PRIMARY KEY,
  user_id      VARCHAR(36) NOT NULL,
  expires_at   TIMESTAMP NOT NULL,
  used         BOOLEAN DEFAULT FALSE
);
