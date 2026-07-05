# Example Task Plan: Add Authentication Middleware

## Overview
This task adds JWT authentication middleware to protect API routes in the Express.js application.

## Architecture Decisions
- Use jsonwebtoken library for JWT signing/verification
- Store JWT secret in environment variables
- Middleware validates token and attaches user info to request
- Protect /api/* routes except auth endpoints

## File Changes
- src/middleware/auth.js - New middleware file
- src/server.js - Import and apply middleware
- src/routes/auth.js - Add login endpoint for testing
- .env.example - Add JWT_SECRET example

## Testing Strategy
- Unit tests for auth middleware (valid/invalid tokens)
- Integration tests for protected routes
- Manual testing with Postman

## Subtasks
| Subtask ID | Description | Owner | Files to Modify | Dependencies | Expected Output |
|------------|-------------|-------|-----------------|--------------|-----------------|
| 01-auth-middleware | Create JWT authentication middleware | worker | src/middleware/auth.js | None | Middleware file with verifyToken function |
| 02-apply-middleware | Apply middleware to server | worker | src/server.js | 01-auth-middleware | Middleware applied to /api routes |
| 03-auth-routes | Create login/logout auth routes | worker | src/routes/auth.js | 01-auth-middleware | Login endpoint that returns JWT |
| 04-update-env | Update environment example | worker | .env.example | None | JWT_SECRET example added |
| 05-write-tests | Write unit and integration tests | worker | tests/auth.middleware.test.ts, tests/auth.routes.test.ts | 01-04 | Passing test suite |