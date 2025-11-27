// Cloudflare Pages Worker (取代 functions/api/notes.js)
// 這個 Worker 檔案會處理所有傳給 /api/notes 的請求

// 輔助函數：統一的回應格式
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // 允許 CORS
    },
});

// 輔助函數：錯誤回應
const errorResponse = (message, status = 500) => jsonResponse({ message }, status);

// 處理所有請求的函數
async function handleRequest(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const { method } = request;
    
    // 檢查路由是否為 /api/notes 或 /api/notes/{id}
    const match = pathname.match(/^\/api\/notes\/?([a-zA-Z0-9-]+)?$/);
    
    // 如果路徑不匹配 /api/notes，則讓 Pages 處理靜態檔案
    if (!match) {
        // 必須返回 undefined 讓 Pages 靜態資產處理器接管
        return undefined;
    }

    // 獲取 D1 資料庫繫結 (名稱必須是 NOTES_DB)
    const db = env.NOTES_DB;
    
    // 從前端請求頭獲取用戶 Session ID (用於資料隔離)
    const userSessionId = request.headers.get('X-User-Session');
    
    if (!userSessionId) {
        return errorResponse('Missing X-User-Session header. User must be initialized.', 401);
    }
    
    // 提取筆記 ID (如果有的話)
    const noteId = match[1] || null;

    try {
        switch (method) {
            
            // --- GET: 讀取所有筆記 ---
            case 'GET': {
                // 查詢該 Session ID 的所有筆記
                const { results } = await db.prepare(
                    'SELECT id, title, content, created_at FROM notes WHERE user_session_id = ? ORDER BY created_at DESC'
                ).bind(userSessionId).all();
                
                return jsonResponse(results);
            }

            // --- POST: 新增筆記 ---
            case 'POST': {
                const { title, content } = await request.json();
                const newId = crypto.randomUUID();
                const timestamp = Date.now();

                await db.prepare(
                    'INSERT INTO notes (id, user_session_id, title, content, created_at) VALUES (?, ?, ?, ?, ?)'
                ).bind(newId, userSessionId, title || '(無標題)', content, timestamp).run();

                return jsonResponse({ id: newId, title, content, created_at: timestamp }, 201);
            }

            // --- PUT: 更新筆記 ---
            case 'PUT': {
                if (!noteId) {
                    return errorResponse('Missing note ID for update.', 400);
                }
                const { title, content } = await request.json();
                
                const updateResult = await db.prepare(
                    'UPDATE notes SET title = ?, content = ? WHERE id = ? AND user_session_id = ?'
                ).bind(title || '(無標題)', content, noteId, userSessionId).run();

                if (updateResult.changes === 0) { 
                    return errorResponse('Note not found or you do not own this note.', 404);
                }

                return jsonResponse({ message: 'Note updated successfully' });
            }

            // --- DELETE: 刪除筆記 ---
            case 'DELETE': {
                if (!noteId) {
                    return errorResponse('Missing note ID for deletion.', 400);
                }

                const deleteResult = await db.prepare(
                    'DELETE FROM notes WHERE id = ? AND user_session_id = ?'
                ).bind(noteId, userSessionId).run();
                
                if (deleteResult.changes === 0) { 
                     return errorResponse('Note not found or you do not own this note.', 404);
                }

                return jsonResponse({ message: 'Note deleted successfully' });
            }

            default:
                return errorResponse(`Method ${method} not allowed.`, 405);
        }
    } catch (error) {
        console.error('D1 Operation Error:', error);
        return errorResponse(`Database error: ${error.message}`, 500);
    }
}

// Pages Worker 的入口點
export default {
    async fetch(request, env, ctx) {
        // 首先嘗試讓 Worker 處理請求
        const response = await handleRequest(request, env);
        
        // 如果 handleRequest 返回 undefined，表示它不是 API 請求，
        // 則讓 Pages 處理靜態檔案 (index.html)
        if (response !== undefined) {
            return response;
        }

        // 必須讓 Pages 處理靜態資源，所以返回 undefined
        return undefined; 
    },
};

      
