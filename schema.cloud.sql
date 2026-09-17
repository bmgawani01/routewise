-- Cloud schema for a managed MySQL host (e.g. Aiven). Uses the provider's default
-- database, so it has no CREATE DATABASE / USE statements. Run against DB_NAME.

CREATE TABLE IF NOT EXISTS drivers (
  driver_id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(60) NOT NULL,
  last_name VARCHAR(60) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  date_of_birth DATE NULL,
  national_id VARCHAR(60) NULL,
  address_line VARCHAR(160) NULL,
  city VARCHAR(60) NULL,
  status ENUM('pending','approved','rejected','active') NOT NULL DEFAULT 'pending',
  onboarded TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS otp_codes (
  otp_id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  code CHAR(6) NOT NULL,
  expires_at DATETIME NOT NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_phone (phone)
);

CREATE TABLE IF NOT EXISTS vehicles (
  vehicle_id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT NOT NULL,
  vehicle_type ENUM('car','motorcycle','bicycle','van','truck') NOT NULL,
  make VARCHAR(60) NOT NULL,
  model VARCHAR(60) NOT NULL,
  year_made YEAR NULL,
  reg_number VARCHAR(20) NOT NULL,
  insurance_provider VARCHAR(80) NULL,
  insurance_expiry DATE NULL,
  FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents (
  document_id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT NOT NULL,
  doc_type ENUM('national_id_photo','selfie','driving_licence','vehicle_registration','insurance_certificate') NOT NULL,
  file_name VARCHAR(160) NULL,
  mime_type VARCHAR(80) NULL,
  file_path VARCHAR(255) NULL,
  size_kb INT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_driver_doc (driver_id, doc_type),
  FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS applications (
  application_id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT NOT NULL UNIQUE,
  status ENUM('submitted','under_review','approved','rejected') NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  review_notes VARCHAR(255) NULL,
  reviewed_by VARCHAR(60) NULL,
  FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE
);
