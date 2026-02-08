/*
  SERVER.JS - Music Battle Backend

  This is your first backend! It does 3 things:
  1. Serves your website files
  2. Stores votes in a database
  3. Provides an API for the frontend to talk to
*/

const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

// ============================================
// SETUP
// ============================================

const app = express();
const PORT = process.env.PORT || 3000;  // Use Railway's port or default to 3000

// Middleware (these process requests before your code runs)
app.use(cors());                          // Allow requests from other origins
app.use(express.json());                  // Parse JSON request bodies
app.use(express.static(path.join(__dirname)));  // Serve static files (HTML, CSS, JS)

// ============================================
// DATABASE SETUP
// ============================================

// Create/connect to database file
const db = new Database('musicbattle.db');

// Create tables if they don't exist
db.exec(`
  -- Songs table: stores all songs and their total votes
  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    youtube_id TEXT NOT NULL,
    start_time INTEGER DEFAULT 0,
    votes INTEGER DEFAULT 0
  );

  -- Votes table: stores every individual vote (for the algorithm later)
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    winner_id INTEGER NOT NULL,
    loser_id INTEGER NOT NULL,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (winner_id) REFERENCES songs(id),
    FOREIGN KEY (loser_id) REFERENCES songs(id)
  );
`);

// Initial songs data - expanded library!
const initialSongs = [
  // Pop Hits
  { id: 1, title: "Blinding Lights", artist: "The Weeknd", youtube_id: "4NRXx6U8ABQ", start_time: 30 },
  { id: 2, title: "Levitating", artist: "Dua Lipa", youtube_id: "TUVcZfQe-Kw", start_time: 45 },
  { id: 3, title: "As It Was", artist: "Harry Styles", youtube_id: "H5v3kku4y6Q", start_time: 25 },
  { id: 4, title: "Stay", artist: "Kid Laroi & Justin Bieber", youtube_id: "kTJczUoc26U", start_time: 15 },
  { id: 5, title: "Bad Guy", artist: "Billie Eilish", youtube_id: "DyDfgMOUjCI", start_time: 20 },
  { id: 6, title: "Shivers", artist: "Ed Sheeran", youtube_id: "Il0S8BoucSA", start_time: 50 },
  { id: 7, title: "Heat Waves", artist: "Glass Animals", youtube_id: "mRD0-GxqHVo", start_time: 60 },
  { id: 8, title: "Peaches", artist: "Justin Bieber", youtube_id: "tQ0yjYUFKAE", start_time: 30 },

  // More Pop & R&B
  { id: 9, title: "Uptown Funk", artist: "Bruno Mars", youtube_id: "OPf0YbXqDm0", start_time: 60 },
  { id: 10, title: "Shape of You", artist: "Ed Sheeran", youtube_id: "JGwWNGJdvx8", start_time: 45 },
  { id: 11, title: "Closer", artist: "The Chainsmokers ft. Halsey", youtube_id: "PT2_F-1esPk", start_time: 55 },
  { id: 12, title: "Starboy", artist: "The Weeknd ft. Daft Punk", youtube_id: "34Na4j8AVgA", start_time: 40 },
  { id: 13, title: "Don't Start Now", artist: "Dua Lipa", youtube_id: "oygrmJFKYZY", start_time: 30 },
  { id: 14, title: "Watermelon Sugar", artist: "Harry Styles", youtube_id: "E07s5ZYygMg", start_time: 35 },

  // Hip-Hop & Rap
  { id: 15, title: "SICKO MODE", artist: "Travis Scott", youtube_id: "6ONRf7h3Mdk", start_time: 120 },
  { id: 16, title: "God's Plan", artist: "Drake", youtube_id: "xpVfcZ0ZcFM", start_time: 50 },
  { id: 17, title: "Rockstar", artist: "Post Malone ft. 21 Savage", youtube_id: "UceaB4D0jpo", start_time: 30 },
  { id: 18, title: "Hotline Bling", artist: "Drake", youtube_id: "uxpDa-c-4Mc", start_time: 45 },
  { id: 19, title: "Sunflower", artist: "Post Malone & Swae Lee", youtube_id: "ApXoWvfEYVU", start_time: 25 },
  { id: 20, title: "Old Town Road", artist: "Lil Nas X", youtube_id: "w2Ov5jzm3j8", start_time: 20 },

  // Rock & Alternative
  { id: 21, title: "Believer", artist: "Imagine Dragons", youtube_id: "7wtfhZwyrcc", start_time: 55 },
  { id: 22, title: "Thunder", artist: "Imagine Dragons", youtube_id: "fKopy74weus", start_time: 40 },
  { id: 23, title: "Stressed Out", artist: "Twenty One Pilots", youtube_id: "pXRviuL6vMY", start_time: 60 },
  { id: 24, title: "Heathens", artist: "Twenty One Pilots", youtube_id: "UprcpdwuwCg", start_time: 30 },

  // Dance & Electronic
  { id: 25, title: "Lean On", artist: "Major Lazer & DJ Snake", youtube_id: "YqeW9_5kURI", start_time: 45 },
  { id: 26, title: "Titanium", artist: "David Guetta ft. Sia", youtube_id: "JRfuAukYTKg", start_time: 60 },
  { id: 27, title: "Wake Me Up", artist: "Avicii", youtube_id: "IcrbM1l_BoI", start_time: 40 },
  { id: 28, title: "Clarity", artist: "Zedd ft. Foxes", youtube_id: "IxxstCcJlsc", start_time: 55 },

  // Classic Vibes
  { id: 29, title: "Bohemian Rhapsody", artist: "Queen", youtube_id: "fJ9rUzIMcZQ", start_time: 50 },
  { id: 30, title: "Billie Jean", artist: "Michael Jackson", youtube_id: "Zi_XLOBDo_Y", start_time: 30 }
];

// Insert initial songs if table is empty
const songCount = db.prepare('SELECT COUNT(*) as count FROM songs').get();
if (songCount.count === 0) {
  const insert = db.prepare(`
    INSERT INTO songs (id, title, artist, youtube_id, start_time, votes)
    VALUES (?, ?, ?, ?, ?, 0)
  `);

  initialSongs.forEach(song => {
    insert.run(song.id, song.title, song.artist, song.youtube_id, song.start_time);
  });
  console.log('Database initialized with songs!');
}

// ============================================
// API ROUTES
// ============================================

// GET /api/songs - Get all songs with vote counts
app.get('/api/songs', (req, res) => {
  const songs = db.prepare('SELECT * FROM songs ORDER BY votes DESC').all();
  res.json(songs);
});

// GET /api/battle - Get two random songs for a battle
app.get('/api/battle', (req, res) => {
  const songs = db.prepare('SELECT * FROM songs ORDER BY RANDOM() LIMIT 2').all();
  res.json({
    left: songs[0],
    right: songs[1]
  });
});

// POST /api/vote - Submit a vote
app.post('/api/vote', (req, res) => {
  const { winnerId, loserId } = req.body;

  if (!winnerId || !loserId) {
    return res.status(400).json({ error: 'winnerId and loserId required' });
  }

  // Record the vote
  db.prepare('INSERT INTO votes (winner_id, loser_id) VALUES (?, ?)').run(winnerId, loserId);

  // Update the winner's vote count
  db.prepare('UPDATE songs SET votes = votes + 1 WHERE id = ?').run(winnerId);

  // Get updated song data
  const winner = db.prepare('SELECT * FROM songs WHERE id = ?').get(winnerId);

  res.json({
    success: true,
    message: `Vote recorded for ${winner.title}!`,
    newVoteCount: winner.votes
  });
});

// GET /api/stats - Get overall statistics
app.get('/api/stats', (req, res) => {
  const totalVotes = db.prepare('SELECT COUNT(*) as count FROM votes').get();
  const topSongs = db.prepare('SELECT title, artist, votes FROM songs ORDER BY votes DESC LIMIT 5').all();

  res.json({
    totalBattles: totalVotes.count,
    topSongs: topSongs
  });
});

// GET /api/leaderboard - Get songs ranked by votes
app.get('/api/leaderboard', (req, res) => {
  const songs = db.prepare(`
    SELECT title, artist, votes,
           RANK() OVER (ORDER BY votes DESC) as rank
    FROM songs
    ORDER BY votes DESC
  `).all();

  res.json(songs);
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log('');
  console.log('🎵 Music Battle Server Running!');
  console.log(`📍 Open http://localhost:${PORT} in your browser`);
  console.log('');
  console.log('API Endpoints:');
  console.log(`   GET  http://localhost:${PORT}/api/songs`);
  console.log(`   GET  http://localhost:${PORT}/api/battle`);
  console.log(`   POST http://localhost:${PORT}/api/vote`);
  console.log(`   GET  http://localhost:${PORT}/api/stats`);
  console.log(`   GET  http://localhost:${PORT}/api/leaderboard`);
  console.log('');
});
