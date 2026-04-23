const express = require('express')
const pool = require('../lib/db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// GET /api/messages/:roomId
router.get('/:roomId', requireAuth, async (req, res) => {
  const { roomId } = req.params
  const limit = Math.min(parseInt(req.query.limit) || 50, 100)
  const before = req.query.before

  try {
    let query = `
      SELECT m.*, 
        u.username AS sender_username,
        u.avatar_url AS sender_avatar
      FROM chatapp_messages m
      LEFT JOIN chatapp_users u ON u.id = m.sender_id
      WHERE m.room_id = $1
    `
    const values = [roomId]

    if (before) {
      query += ` AND m.created_at < $2`
      values.push(before)
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${values.length + 1}`
    values.push(limit)

    const result = await pool.query(query, values)

    // Return chronologically
    const messages = result.rows.reverse().map(row => ({
      id: row.id,
      room_id: row.room_id,
      sender_id: row.sender_id,
      content: row.content,
      file_url: row.file_url,
      file_name: row.file_name,
      created_at: row.created_at,
      profiles: {
        id: row.sender_id,
        username: row.sender_username,
        avatar_url: row.sender_avatar
      }
    }))

    res.json(messages)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/messages (HTTP fallback; Socket.io is primary)
router.post('/', requireAuth, async (req, res) => {
  const { room_id, content, file_url, file_name } = req.body
  if (!room_id || !content?.trim()) {
    return res.status(400).json({ error: 'room_id and content are required' })
  }

  try {
    const result = await pool.query(
      `INSERT INTO chatapp_messages (room_id, sender_id, content, file_url, file_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [room_id, req.user.id, content.trim(), file_url || null, file_name || null]
    )
    const msg = result.rows[0]

    // Get sender profile
    const userResult = await pool.query(
      'SELECT username, avatar_url FROM chatapp_users WHERE id = $1',
      [req.user.id]
    )
    const user = userResult.rows[0]

    const fullMsg = {
      ...msg,
      profiles: { id: req.user.id, username: user?.username, avatar_url: user?.avatar_url }
    }

    // Emit via socket if available
    if (req.app.get('io')) {
      req.app.get('io').to(room_id).emit('new_message', fullMsg)
    }

    res.status(201).json(fullMsg)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/messages/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const check = await pool.query('SELECT sender_id FROM chatapp_messages WHERE id = $1', [req.params.id])
    if (!check.rows[0]) return res.status(404).json({ error: 'Message not found' })
    if (check.rows[0].sender_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' })

    await pool.query('DELETE FROM chatapp_messages WHERE id = $1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
