# E-SBA (Electronic School Based Assessment)

E-SBA is a comprehensive assessment management system designed for Junior High Schools. This repository contains the full source code for the React frontend and Express/Node.js backend.

## 1. Configuration Overview

The application is configured using a combination of **Environment Variables** (for server-side credentials and infrastructure) and **Runtime Configuration** (for school-specific settings stored in the browser).

### Environment Variables

Create a `.env` file in the project root. The application supports `.env`, `.env.development`, and `.env.local`.

#### Core Server

| Variable       | Default | Description                                                      |
| -------------- | ------- | ---------------------------------------------------------------- |
| `PORT`         | `3001`  | Port for the backend API server.                                 |
| `SCAN_ENABLED` | `0`     | Set to `1` to enable specific scanning features (if applicable). |
| `SCHOOL_NAME`  | `E-SBA` | Default school name used in generated Excel templates.           |

#### Database (MySQL)

The application connects to a MySQL database for the master record storage.

| Variable  | Default         | Description                                                  |
| --------- | --------------- | ------------------------------------------------------------ |
| `DB_HOST` | `localhost`     | Database hostname. Aliases: `MYSQL_HOST`, `DATABASE_HOST`.   |
| `DB_USER` | `esba_app_user` | Database username. Aliases: `MYSQL_USER`, `DATABASE_USER`.   |
| `DB_PASS` | `""` (Empty)    | Database password. Aliases: `DB_PASSWORD`, `MYSQL_PASSWORD`. |
| `DB_NAME` | `esba_jhs_db`   | Database name. Aliases: `MYSQL_DATABASE`, `DATABASE_NAME`.   |

#### Security & Tokens

These tokens secure sensitive API endpoints.

| Variable         | Required | Description                                              |
| ---------------- | -------- | -------------------------------------------------------- |
| `UPLOAD_TOKEN`   | **Yes**  | Required header token for uploading files to the server. |
| `DOWNLOAD_TOKEN` | **Yes**  | Required header token for downloading secure content.    |

#### Cloud Storage (Vercel Blob)

Used for storing larger binary assets if configured.

| Variable                | Required | Description                                                   |
| ----------------------- | -------- | ------------------------------------------------------------- |
| `BLOB_READ_WRITE_TOKEN` | Optional | Token for Vercel Blob storage. Alias: `VERCEL_BLOB_RW_TOKEN`. |

#### Supabase (PostgreSQL)

Optional integration for alternative storage or specific features.

| Variable                    | Required | Description                                                     |
| --------------------------- | -------- | --------------------------------------------------------------- |
| `SUPABASE_URL`              | Optional | URL for the Supabase instance.                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Service role key for admin access.                              |
| `SUPABASE_PG_CONN`          | Optional | Connection string for Supabase Postgres. Alias: `POSTGRES_URL`. |

---

## 2. Setup Instructions

### Prerequisites

- **Node.js**: v18.0.0 or higher.
- **MySQL**: v8.0 or higher (or MariaDB equivalent).
- **Package Manager**: `npm` (included with Node.js).

### Step-by-Step Configuration

1.  **Clone the Repository**

    ```bash
    git clone <repository-url>
    cd e-SBA
    ```

2.  **Install Dependencies**

    ```bash
    npm install
    ```

3.  **Environment Setup**
    Create a `.env` file in the root directory and configure your database credentials and security tokens.

    > **Security Note:** Never commit your `.env` file to version control.

    ```env
    PORT=3001

    # Database Configuration
    DB_HOST=localhost
    DB_USER=your_db_username      # Replace with your local DB user
    DB_PASS=your_db_password      # Replace with your local DB password
    DB_NAME=esba_jhs_db

    # Security Tokens (Generate strong random strings)
    UPLOAD_TOKEN=your_secure_upload_token_here
    DOWNLOAD_TOKEN=your_secure_download_token_here
    ```

4.  **Database Initialization**
    Initialize the local MySQL database with the schema:

    ```bash
    # Resets the database and applies the schema (WARNING: Deletes existing data)
    npm run db:reset
    ```

    Alternatively, use `npm run db:clean` to clear data without dropping tables.

5.  **Start the Application**

    - **Development Mode** (Hot-reload enabled for both frontend and backend):

      ```bash
      # Terminal 1: Frontend (Vite)
      npm run dev

      # Terminal 2: Backend (Express)
      npm run server:dev
      ```

    - **Production Build**:
      ```bash
      npm run build        # Build frontend
      npm run server:build # Build backend
      npm run server:start # Start production server
      ```

---

## 3. Runtime Configuration

Unlike infrastructure settings, **School Configuration** is managed directly within the application UI and persists in the browser's local storage (IndexedDB).

### Dynamic Options

Navigate to the **Settings** or **Profile** section in the application to configure:

- **School Details**: Name, Motto, Address, Head Teacher's name.
- **Assessment Weights**: Class Assessment (Default: 50%) vs. Exam Weight (Default: 50%).
- **Assets**: School Logo and Head Teacher's Signature.
- **Grading System**: Define grade ranges (e.g., 80-100 = Grade 1) and remarks.

### Hot-Reload Capabilities

- **Frontend**: Vite provides Hot Module Replacement (HMR). Changes to React components (`src/`) reflect instantly without a full page reload.
- **Backend**: `tsx` watches for file changes in `server/` and automatically restarts the API server during development.

### Validation

- **Templates**: Generated Excel templates utilize data validation to restrict input types (e.g., numeric scores).
- **Parsing**: The system validates uploaded assessment sheets against the expected schema (Student ID, columns for Task 1-4, etc.).

---

## 4. Security Considerations

### Sensitive Parameters

- **Tokens**: `UPLOAD_TOKEN` and `DOWNLOAD_TOKEN` effectively act as API keys. **Do not** share these or commit them to version control.
- **Database Credentials**: Ensure `DB_PASS` is strong and the database user has only necessary privileges.

### Recommended Practices

1.  **GitIgnore**: Ensure `.env` and `*.local` files are listed in `.gitignore` to prevent accidental commits.
2.  **Token Rotation**: Periodically rotate `UPLOAD_TOKEN` and `DOWNLOAD_TOKEN` in production environments.
3.  **Encryption**: The application includes utilities (`lib/storage.ts`) that support encrypted storage for local data using `crypto.subtle`. When implementing new storage features, enable the `encrypt` flag for sensitive user data.

### Troubleshooting

- **Database Connection Failed**: Verify `DB_HOST` and credentials in `.env`. Ensure the MySQL service is running.
- **Uploads Failing**: Check that the client requests include the `x-upload-token` header matching the `UPLOAD_TOKEN` env var.
- **Version Mismatch**: If you encounter errors related to `Task1-4` vs `cat1-4`, ensure you are using the latest Excel templates generated by the system, as column mappings have been updated.

---

## 5. Version History

- **v1.0.0** (Current): Initial release with comprehensive assessment management, Excel template generation, and student reporting features.

---

## 6. Contribution Guidelines

We welcome contributions to the E-SBA project!

1.  **Fork the Repository**: Create your own copy of the project.
2.  **Create a Branch**: Use a descriptive name (e.g., `feature/new-grading-system` or `fix/upload-bug`).
3.  **Commit Changes**: Ensure your code is clean and well-documented. Sanitize any personal data or secrets from your commits.
4.  **Push to Branch**: Upload your changes to your fork.
5.  **Submit a Pull Request**: Describe your changes and reference any related issues.

Please ensure all tests pass (`npm test`) before submitting.

---

## 7. Author & Contact

**Mr. Felix Akabati**  
Email: [felixakabati007@gmail.com](mailto:felixakabati007@gmail.com)

---

## 8. License & Copyright

**Copyright © 2023 E-SBA. All Rights Reserved.**

This project is licensed under the **MIT License**.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
