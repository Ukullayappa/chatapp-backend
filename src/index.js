require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const pool = require('./lib/db')

const authRoutes = require('./routes/auth')
const roomRoutes = require('./routes/rooms')
const messageRoutes = require('./routes/messages')
const uploadRoutes = require('./routes/upload')
const usersRoutes = require('./routes/users')

const app = express()
const server = http.createServer(app)

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true
  }
})

// Make io accessible in routes
app.set('io', io)

// Middleware
app.use(cors({
  origin: CLIENT_URL,
  credentials: true
}))
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/rooms', roomRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/users', usersRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Something went wrong', message: err.message })
})

// ─── Socket.io ───────────────────────────────────────────────────────────────

// Track online users: userId -> socketId
const onlineUsers = new Map()

io.use((socket, next) => {
  const token = socket.handshake.auth?.token
  if (!token) return next(new Error('Authentication error'))
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    socket.user = decoded
    next()
  } catch {
    next(new Error('Authentication error'))
  }
})

io.on('connection', async (socket) => {
  const userId = socket.user.id
  const username = socket.user.username
  console.log(`🔌 ${username} connected`)

  onlineUsers.set(userId, socket.id)

  // Mark user online in DB
  try {
    await pool.query('UPDATE chatapp_users SET is_online = TRUE WHERE id = $1', [userId])
  } catch (err) {
    console.error('Error updating online status:', err.message)
  }

  // Broadcast updated online users list
  async function broadcastOnlineUsers() {
    try {
      const result = await pool.query(
        'SELECT id, username, avatar_url FROM chatapp_users WHERE is_online = TRUE ORDER BY username ASC'
      )
      io.emit('online_users', result.rows)
    } catch (err) {
      console.error('Error fetching online users:', err.message)
    }
  }

  broadcastOnlineUsers()

  // Join a room
  socket.on('join_room', (roomId) => {
    socket.join(roomId)
  })

  // Leave a room
  socket.on('leave_room', (roomId) => {
    socket.leave(roomId)
  })

  // Send a message
  socket.on('send_message', async ({ room_id, content, file_url, file_name }) => {
    if (!room_id || !content?.trim()) return

    try {
      const result = await pool.query(
        `INSERT INTO chatapp_messages (room_id, sender_id, content, file_url, file_name)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [room_id, userId, content.trim(), file_url || null, file_name || null]
      )
      const msg = result.rows[0]

      const fullMsg = {
        ...msg,
        profiles: {
          id: userId,
          username: socket.user.username,
          avatar_url: socket.user.avatar_url || null
        }
      }

      // Emit to everyone in the room
      io.to(room_id).emit('new_message', fullMsg)
    } catch (err) {
      socket.emit('error', { message: 'Failed to send message' })
      console.error('Send message error:', err.message)
    }
  })

  // Typing indicators
  socket.on('typing_start', ({ room_id }) => {
    socket.to(room_id).emit('user_typing', { userId, username })
  })

  socket.on('typing_stop', ({ room_id }) => {
    socket.to(room_id).emit('user_stopped_typing', { userId })
  })

  // Disconnect
  socket.on('disconnect', async () => {
    console.log(`❌ ${username} disconnected`)
    onlineUsers.delete(userId)

    try {
      await pool.query(
        'UPDATE chatapp_users SET is_online = FALSE, last_seen = NOW() WHERE id = $1',
        [userId]
      )
    } catch (err) {
      console.error('Error updating offline status:', err.message)
    }

    broadcastOnlineUsers()
  })
})

// ─── Start server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
  console.log(`📡 Socket.io enabled`)
})

module.exports = { app, server }
