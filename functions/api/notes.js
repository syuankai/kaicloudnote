// Cloudflare Pages Function 程式碼：處理 /api/notes 的所有請求

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

// 主要處理函數
export async function onRequest(context) {
    const { request, env, params } = context;
    const { method } = request;
    
    // 獲取 D1 資料庫繫結 (必須在 Pages Settings 中命名為 NOTES_DB)
    const db = env.NOTES_DB;
    
    // 從前端請求頭獲取用戶 Session ID (用於資料隔離)
    const userSessionId = request.headers.get('X-User-Session');
    
    if (!userSessionId) {
        // 如果沒有 Session ID，拒絕操作
        return errorResponse('Missing X-User-Session header. User must be initialized.', 401);
    }

    // 獲取 URL 路徑中的 ID（用於 PUT, DELETE）
    const noteId = params.notes && params.notes.length > 0 ? params.notes[0] : null;

    try {
        switch (method) {
            
            // --- GET: 讀取所有筆記 ---
            case 'GET': {
                // 查詢該 Session ID 的所有筆記，並按創建時間降序排列
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

                // 執行插入操作
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
                
                // 執行更新操作：必須同時匹配 ID 和 Session ID 才能更新
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

                // 執行刪除操作：必須同時匹配 ID 和 Session ID 才能刪除
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
        // 捕獲任何 D1 或 JSON 解析錯誤
        console.error('D1 Operation Error:', error);
        return errorResponse(`Database error: ${error.message}`, 500);
    }
}

                  
