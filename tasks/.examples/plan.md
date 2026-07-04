# Plan: Ví dụ Plan File

## Architecture
- Thêm module greeter cho chức năng chào hỏi
- File: `src/greeter.ts` — single function export

## Subtasks

| ID | Owner | Description | Files | Parallelizable | Verification |
|----|-------|-------------|-------|----------------|-------------|
| 01-hello-world | worker | Tạo greeter function | `src/greeter.ts` | N/A (single) | `npm run build` |

## Implementation
- `src/greeter.ts`: export `greet(name: string): string` trả về `Hello, ${name}!`

## Testing Strategy
- Chạy `npm run build` để verify không lỗi syntax/types