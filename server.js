/*
  SERVER.JS - Music Battle Backend with User Accounts
  Phase 4: Authentication + Personalization
*/

const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

// ============================================
// SETUP
// ============================================

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'music-battle-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// ============================================
// DATABASE SETUP
// ============================================

const db = new Database('musicbattle.db');

// Create tables
db.exec(`
  -- Songs table
  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    youtube_id TEXT NOT NULL,
    start_time INTEGER DEFAULT 0,
    votes INTEGER DEFAULT 0
  );

  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Votes table (now tracks user)
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    winner_id INTEGER NOT NULL,
    loser_id INTEGER NOT NULL,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (winner_id) REFERENCES songs(id),
    FOREIGN KEY (loser_id) REFERENCES songs(id)
  );

  -- User preferences (for algorithm)
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT,
    artist TEXT,
    score INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, artist),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Initial songs data - Verified working videos only
const initialSongs = [
  // Pop Hits (verified)
  { id: 1, title: "Blinding Lights", artist: "The Weeknd", youtube_id: "4NRXx6U8ABQ", start_time: 30 },
  { id: 2, title: "Levitating", artist: "Dua Lipa", youtube_id: "TUVcZfQe-Kw", start_time: 45 },
  { id: 3, title: "As It Was", artist: "Harry Styles", youtube_id: "H5v3kku4y6Q", start_time: 25 },
  { id: 4, title: "Stay", artist: "Kid Laroi & Justin Bieber", youtube_id: "kTJczUoc26U", start_time: 15 },
  { id: 5, title: "Bad Guy", artist: "Billie Eilish", youtube_id: "DyDfgMOUjCI", start_time: 20 },
  { id: 6, title: "Shape of You", artist: "Ed Sheeran", youtube_id: "JGwWNGJdvx8", start_time: 45 },
  { id: 7, title: "Heat Waves", artist: "Glass Animals", youtube_id: "mRD0-GxqHVo", start_time: 60 },
  { id: 8, title: "Uptown Funk", artist: "Bruno Mars", youtube_id: "OPf0YbXqDm0", start_time: 60 },
  { id: 9, title: "Starboy", artist: "The Weeknd", youtube_id: "34Na4j8AVgA", start_time: 40 },
  { id: 10, title: "Don't Start Now", artist: "Dua Lipa", youtube_id: "oygrmJFKYZY", start_time: 30 },

  // Hip-Hop (verified)
  { id: 11, title: "God's Plan", artist: "Drake", youtube_id: "xpVfcZ0ZcFM", start_time: 50 },
  { id: 12, title: "Hotline Bling", artist: "Drake", youtube_id: "uxpDa-c-4Mc", start_time: 45 },
  { id: 13, title: "Sunflower", artist: "Post Malone & Swae Lee", youtube_id: "ApXoWvfEYVU", start_time: 25 },
  { id: 14, title: "Old Town Road", artist: "Lil Nas X", youtube_id: "w2Ov5jzm3j8", start_time: 20 },
  { id: 15, title: "HUMBLE", artist: "Kendrick Lamar", youtube_id: "tvTRZJ-4EyI", start_time: 30 },

  // Rock & Alt (verified)
  { id: 16, title: "Believer", artist: "Imagine Dragons", youtube_id: "7wtfhZwyrcc", start_time: 55 },
  { id: 17, title: "Thunder", artist: "Imagine Dragons", youtube_id: "fKopy74weus", start_time: 40 },
  { id: 18, title: "Stressed Out", artist: "Twenty One Pilots", youtube_id: "pXRviuL6vMY", start_time: 60 },
  { id: 19, title: "Bohemian Rhapsody", artist: "Queen", youtube_id: "fJ9rUzIMcZQ", start_time: 50 },

  // Electronic (verified)
  { id: 20, title: "Lean On", artist: "Major Lazer & DJ Snake", youtube_id: "YqeW9_5kURI", start_time: 45 },
  { id: 21, title: "Wake Me Up", artist: "Avicii", youtube_id: "IcrbM1l_BoI", start_time: 40 },
  { id: 22, title: "Titanium", artist: "David Guetta ft. Sia", youtube_id: "JRfuAukYTKg", start_time: 60 },

  // Latin (verified)
  { id: 23, title: "Despacito", artist: "Luis Fonsi ft. Daddy Yankee", youtube_id: "kJQP7kiw5Fk", start_time: 50 },
  { id: 24, title: "Calm Down", artist: "Rema & Selena Gomez", youtube_id: "WcIcVapfqXw", start_time: 50 },

  // R&B (verified)
  { id: 25, title: "Earned It", artist: "The Weeknd", youtube_id: "waU75jdUnYw", start_time: 60 }
];

// Force refresh songs to 25 clean videos
db.exec('DELETE FROM songs');
const insert = db.prepare('INSERT INTO songs (id, title, artist, youtube_id, start_time, votes) VALUES (?, ?, ?, ?, ?, 0)');
initialSongs.forEach(song => {
  insert.run(song.id, song.title, song.artist, song.youtube_id, song.start_time);
});
console.log('Database refreshed with 25 verified songs!');

// ============================================
// AUTH ROUTES
// ============================================

// Sign up
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }

  if (password.length < 4 || password.length > 15) {
    return res.status(400).json({ error: 'Password must be 4-15 characters' });
  }

  try {
    // Check if user exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing) {
      return res.status(400).json({ error: 'Username or email already taken' });
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)')
      .run(userId, username, email, passwordHash);

    // Set session
    req.session.userId = userId;
    req.session.username = username;

    res.json({ success: true, user: { id: userId, username, email } });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user
app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user });
});

// ============================================
// SONG ROUTES
// ============================================

// Get all songs
app.get('/api/songs', (req, res) => {
  const songs = db.prepare('SELECT * FROM songs ORDER BY votes DESC').all();
  res.json(songs);
});

// Get battle (smart matching based on user preferences)
app.get('/api/battle', (req, res) => {
  let songs;

  if (req.session.userId) {
    // For logged-in users, try to include songs from preferred artists sometimes
    const preferences = db.prepare(`
      SELECT artist, score FROM user_preferences
      WHERE user_id = ? ORDER BY score DESC LIMIT 5
    `).all(req.session.userId);

    if (preferences.length > 0 && Math.random() > 0.5) {
      // 50% chance to include a preferred artist
      const preferredArtist = preferences[Math.floor(Math.random() * preferences.length)].artist;
      const preferredSong = db.prepare('SELECT * FROM songs WHERE artist LIKE ? ORDER BY RANDOM() LIMIT 1')
        .get(`%${preferredArtist}%`);
      const otherSong = db.prepare('SELECT * FROM songs WHERE id != ? ORDER BY RANDOM() LIMIT 1')
        .get(preferredSong?.id || 0);

      if (preferredSong && otherSong) {
        songs = Math.random() > 0.5 ? [preferredSong, otherSong] : [otherSong, preferredSong];
      }
    }
  }

  // Default: random songs
  if (!songs) {
    songs = db.prepare('SELECT * FROM songs ORDER BY RANDOM() LIMIT 2').all();
  }

  res.json({ left: songs[0], right: songs[1] });
});

// Submit vote
app.post('/api/vote', (req, res) => {
  const { winnerId, loserId } = req.body;
  const userId = req.session.userId || null;

  if (!winnerId || !loserId) {
    return res.status(400).json({ error: 'winnerId and loserId required' });
  }

  // Record vote
  db.prepare('INSERT INTO votes (user_id, winner_id, loser_id) VALUES (?, ?, ?)').run(userId, winnerId, loserId);
  db.prepare('UPDATE songs SET votes = votes + 1 WHERE id = ?').run(winnerId);

  // Update user preferences if logged in
  if (userId) {
    const winner = db.prepare('SELECT artist FROM songs WHERE id = ?').get(winnerId);
    const loser = db.prepare('SELECT artist FROM songs WHERE id = ?').get(loserId);

    if (winner) {
      db.prepare(`
        INSERT INTO user_preferences (user_id, artist, score)
        VALUES (?, ?, 1)
        ON CONFLICT(user_id, artist) DO UPDATE SET score = score + 1
      `).run(userId, winner.artist);
    }

    if (loser) {
      db.prepare(`
        INSERT INTO user_preferences (user_id, artist, score)
        VALUES (?, ?, -1)
        ON CONFLICT(user_id, artist) DO UPDATE SET score = score - 1
      `).run(userId, loser.artist);
    }
  }

  const updatedSong = db.prepare('SELECT * FROM songs WHERE id = ?').get(winnerId);
  res.json({ success: true, message: `Vote recorded for ${updatedSong.title}!`, newVoteCount: updatedSong.votes });
});

// ============================================
// STATS ROUTES
// ============================================

// Global stats
app.get('/api/stats', (req, res) => {
  const totalVotes = db.prepare('SELECT COUNT(*) as count FROM votes').get();
  const topSongs = db.prepare('SELECT title, artist, votes FROM songs ORDER BY votes DESC LIMIT 5').all();
  res.json({ totalBattles: totalVotes.count, topSongs });
});

// User stats (for logged in users)
app.get('/api/stats/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const userId = req.session.userId;
  const userVotes = db.prepare('SELECT COUNT(*) as count FROM votes WHERE user_id = ?').get(userId);
  const topArtists = db.prepare(`
    SELECT artist, score FROM user_preferences
    WHERE user_id = ? AND score > 0
    ORDER BY score DESC LIMIT 5
  `).all(userId);

  const recentVotes = db.prepare(`
    SELECT s.title, s.artist, v.voted_at
    FROM votes v
    JOIN songs s ON v.winner_id = s.id
    WHERE v.user_id = ?
    ORDER BY v.voted_at DESC LIMIT 10
  `).all(userId);

  res.json({
    totalVotes: userVotes.count,
    topArtists,
    recentVotes
  });
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
  const songs = db.prepare(`
    SELECT title, artist, votes, RANK() OVER (ORDER BY votes DESC) as rank
    FROM songs ORDER BY votes DESC
  `).all();
  res.json(songs);
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log('');
  console.log('🎵 Music Battle Server Running!');
  console.log(`📍 http://localhost:${PORT}`);
  console.log('');
});
