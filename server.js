const express = require('express');
require('dotenv').config();
const mysql = require('mysql2');
const path = require('path');
const pool = require('./db');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const PORT = 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } 
}));


function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  return res.redirect('/login');
}

function isArtist(req, res, next) {
  if (req.session.user && req.session.user.role === 'artist') {
    return next();
  }
  return res.status(403).send('Access denied. Only artists can upload products.');
}






// Dummy user setup (until authentication is implemented)
// app.use((req, res, next) => {
//   req.userId = 3; // hardcoded customer
//   req.artistId = 4; // hardcoded artist
//   next();
// });

// Routes

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/signup', async (req, res) => {
  const {
    firstName, lastName, email, password,
    street, area, city, state, country,
    postcode, phoneNumber
  } = req.body;

  try {
    const [existingUsers] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) return res.status(400).send("User already exists");

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users 
      (first_name, last_name, email, password, street, area, city, state, country, postcode, phone_number, role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'customer')`,
      [firstName, lastName, email, hashedPassword, street, area, city, state, country, postcode, phoneNumber]
    );

    res.redirect('/');
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).send("Server error");
  }
});

app.get('/login', (req, res) => {
  res.render('login');
});


app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const query = 'SELECT * FROM users WHERE email = ?';
  try {
    const [results] = await pool.query(query, [email]);
    if (results.length === 0) {
      return res.send('Invalid email or password');
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.send('Invalid email or password');
    }

    // Store user info in session
    req.session.user = {
      id: user.id,
      role: user.role
    };

    // Redirect based on role
    if (user.role === 'artist') {
      return res.redirect('/artistDashboard');
    } else {
      return res.redirect('/userDashboard');
    }
  } catch (err) {
    console.error('Database error:', err);
    return res.send('Something went wrong. Please try again later.');
  }
});



app.get('/artistRegistration', (req, res) => {
  res.render('artistRegistration');
});

app.post('/artistRegistration', async (req, res) => {
  const {
    firstName, lastName, email, password,
    street, area, city, state, country,
    postcode, phoneNumber, portfolioLink, socialMediaLink, role
  } = req.body;

  try {
    const [results] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);

    if (results.length > 0) {
      const userId = results[0].id;

      await pool.query("UPDATE users SET role = 'artist' WHERE id = ?", [userId]);
      await pool.query(
        `INSERT INTO artists (user_id, portfolio_link, social_media_link, artist_type)
         VALUES (?, ?, ?, ?)`,
        [userId, portfolioLink, socialMediaLink, role]
      );

      res.send("Existing user upgraded to artist");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const [result] = await pool.query(
        `INSERT INTO users 
         (first_name, last_name, email, password, street, area, city, state, country, postcode, phone_number, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'artist')`,
        [firstName, lastName, email, hashedPassword, street, area, city, state, country, postcode, phoneNumber]
      );

      const userId = result.insertId;

      await pool.query(
        `INSERT INTO artists (user_id, portfolio_link, social_media_link, artist_type)
         VALUES (?, ?, ?, ?)`,
        [userId, portfolioLink, socialMediaLink, role]
      );

      res.send("New artist registered successfully");
    }
  } catch (error) {
    console.error("Artist registration error:", error);
    res.status(500).send("Server error");
  }
});

app.get('/products', async (req, res) => {
  try {
    const [results] = await pool.query("SELECT * FROM products");
    res.render("productPage", { products: results });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.send("Error fetching products");
  }
});

app.get('/products/:id',isAuthenticated, async (req, res) => {
  const productId = req.params.id;

  try {
    // Main product
    const [productResult] = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);
    if (productResult.length === 0) return res.send('Product not found');
    const product = productResult[0];

    // Fetch any 4 other products (random)
    const [similarProducts] = await pool.query(
      'SELECT * FROM products WHERE id != ? ORDER BY RAND() LIMIT 4',
      [productId]
    );

    // Pass both to the EJS template
    res.render('productDetail', { product, similarProducts });
  } catch (error) {
    console.error('Product detail error:', error);
    res.status(500).send('Database error');
  }
});



// Helper function
async function getUserCart(userId) {
  const [existingCarts] = await pool.query('SELECT * FROM carts WHERE user_id = ?', [userId]);
  if (existingCarts.length > 0) return existingCarts[0].id;

  const [result] = await pool.query('INSERT INTO carts (user_id) VALUES (?)', [userId]);
  return result.insertId;
}



app.post('/add-to-cart',isAuthenticated, async (req, res) => {
  const { product_id, quantity } = req.body;
  const userId = req.session.user.id;

  try {
    const cartId = await getUserCart(userId);

    const [existing] = await pool.query(
      'SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?',
      [cartId, product_id]
    );

    if (existing.length > 0) {
      await pool.query(
        'UPDATE cart_items SET quantity = quantity + ? WHERE cart_id = ? AND product_id = ?',
        [quantity, cartId, product_id]
      );
    } else {
      await pool.query(
        'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)',
        [cartId, product_id, quantity]
      );
    }

    res.redirect('/cart');
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).send('Server error');
  }
});


app.post('/cart/update', isAuthenticated,async (req, res) => {
  const userId = req.session.user.id;
  const { product_id, action } = req.body;

  try {
    // Get the user's cart
    const [carts] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
    if (carts.length === 0) return res.redirect('/cart');

    const cartId = carts[0].id;
    
    // Get current item quantity
    const [cartItems] = await pool.query(
      'SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?',
      [cartId, product_id]
    );

    if (cartItems.length === 0) {
      return res.redirect('/cart');
    }

    let newQuantity = cartItems[0].quantity;
    
    // Update quantity based on action
    if (action === 'increase') {
      newQuantity += 1;
    } else if (action === 'decrease') {
      newQuantity -= 1;
    }

    // Remove item if quantity is 0 or less
    if (newQuantity <= 0) {
      await pool.query(
        'DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?',
        [cartId, product_id]
      );
    } else {
      // Update the quantity
      await pool.query(
        'UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?',
        [newQuantity, cartId, product_id]
      );
    }

    res.redirect('/cart');
  } catch (error) {
    console.error('Update cart error:', error);
    res.status(500).send('Server error');
  }
});


app.get('/cart',isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;

  try {
    const [carts] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
    if (carts.length === 0) return res.render('cart', { cartItems: [], totalAmount: 0, shippingCost: 0, taxAmount: 0 });

    const cartId = carts[0].id;
    const [cartItems] = await pool.query(`
      SELECT ci.product_id, ci.quantity, p.title AS product_name, p.price, p.image
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = ?`, [cartId]);

    const totalAmount = cartItems.reduce((total, item) =>
      total + parseFloat(item.price) * item.quantity, 0);

    const shippingCost = 50; // flat rate
    const taxAmount = totalAmount * 0.05;

    res.render('cart', { cartItems, totalAmount, shippingCost, taxAmount });
  } catch (error) {
    console.error('Cart view error:', error);
    res.status(500).send('Server error');
  }
});


app.post('/cart/remove', isAuthenticated,async (req, res) => {
  const userId = req.session.user.id;
  const { product_id } = req.body;

  try {
    const [carts] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
    if (carts.length === 0) return res.redirect('/cart');

    const cartId = carts[0].id;
    await pool.query('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?', [cartId, product_id]);
    res.redirect('/cart');
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).send('Server error');
  }
});

// app.post('/cart/remove', async (req, res) => {
//   const userId = req.userId;
//   const { product_id } = req.body;

//   try {
//     const [carts] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
//     if (carts.length === 0) return res.redirect('/cart');

//     const cartId = carts[0].id;
//     await pool.query('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?', [cartId, product_id]);
//     res.redirect('/cart');
//   } catch (error) {
//     console.error('Remove from cart error:', error);
//     res.status(500).send('Server error');
//   }
// });

app.get('/checkout',isAuthenticated, (req, res) => {
  res.render('checkout');
});

app.post('/checkout/confirm', isAuthenticated,async (req, res) => {
  const userId = req.session.user.id;
  const { address, phone } = req.body;

  try {
    const [carts] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
    if (carts.length === 0) return res.redirect('/cart');

    const cartId = carts[0].id;
    const [cartItems] = await pool.query(`
      SELECT ci.product_id, ci.quantity, p.price
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = ?`, [cartId]);

    if (!cartItems.length) return res.redirect('/cart');

    const totalAmount = cartItems.reduce((total, item) =>
      total + parseFloat(item.price) * item.quantity, 0);

    const [orderResult] = await pool.query(
      'INSERT INTO orders (user_id, total_amount, shipping_address, contact_number) VALUES (?, ?, ?, ?)',
      [userId, totalAmount, address, phone]
    );

    const orderId = orderResult.insertId;

    for (const item of cartItems) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
        [orderId, item.product_id, item.quantity, item.price]
      );
    }

    await pool.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
    res.render('orderSuccess', { orderId });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).send('Server error');
  }
});

app.get('/upload-product',isArtist, (req, res) => {
  res.render('upload-product');
});

app.post('/upload-product',isArtist, async (req, res) => {
  try {
    const { title, description, price, image, rating } = req.body;
    const artistId = req.session.user.id;

    await pool.query(
      'INSERT INTO products (title, description, price, image, rating, artist_id) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description, price, image, rating, artistId]
    );

    res.send('Product uploaded successfully!');
  } catch (err) {
    console.error('Product upload error:', err);
    res.status(500).send('Error uploading product');
  }
});

app.get('/userDashboard',isAuthenticated, async (req, res) => {
  
  if (!req.session.user || !req.session.user.id) {
    return res.redirect('/login'); 
  }

  const userId = req.session.user.id;

  try {
    
    const [userData] = await pool.query(`
      SELECT first_name, last_name, email, phone_number, city, state, country, postcode, role 
      FROM users 
      WHERE id = ?
    `, [userId]);

    if (!userData.length) {
      return res.status(404).send('User not found');
    }

    // Fetch user's orders
    const [orders] = await pool.query(`
      SELECT id, total_amount, created_at 
      FROM orders 
      WHERE user_id = ? 
      ORDER BY created_at DESC
    `, [userId]);

    res.render('userDashboard', {
      user: userData[0],
      orders
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Server error');
  }
});



app.get('/artistDashboard',isAuthenticated,isArtist, async (req, res) => {
  const userId = req.session.user.id;

  try {
    // Get artist profile (users + artists info)
    const [[artistProfile]] = await pool.query(`
      SELECT u.first_name, u.last_name, u.email, u.phone_number, u.city, u.state, u.country,
             a.portfolio_link, a.social_media_link, a.artist_type
      FROM users u
      JOIN artists a ON u.id = a.user_id
      WHERE u.id = ?
    `, [userId]);

    // Get exhibitions created by the artist
    const [exhibitions] = await pool.query(`
      SELECT id, title, description, start_date, end_date, location, created_at
      FROM exhibitions
      WHERE artist_id = ?
      ORDER BY created_at DESC
    `, [userId]);

    // Get orders (if artist made purchases)
    const [orders] = await pool.query(`
      SELECT id, total_amount, created_at
      FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [userId]);

    res.render('artistDashboard', {
      artist: artistProfile,
      exhibitions,
      orders
    });
  } catch (error) {
    console.error('Artist dashboard error:', error);
    res.status(500).send('Server error');
  }
});


app.get('/createExhibition', isAuthenticated, isArtist, (req, res) => {
  res.render('createExhibition');
});

// POST route to handle the exhibition creation
app.post('/createExhibition', isAuthenticated, isArtist, async (req, res) => {
  const { title, description, start_date, end_date, location } = req.body;
  const userId = req.session.user.id;
  const errors = [];
  
  // Server-side validation
  if (!title || !start_date || !end_date || !location) {
    errors.push('Please fill all required fields');
  }
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (startDate < today) {
    errors.push('Start date must be today or in the future');
  }
  
  if (endDate < startDate) {
    errors.push('End date must be after the start date');
  }
  
  // If validation fails, re-render the form with errors
  if (errors.length > 0) {
    return res.render('createExhibition', {
      errors,
      formData: req.body
    });
  }
  
  try {
    // Insert the new exhibition into the database
    const [result] = await pool.query(`
      INSERT INTO exhibitions (artist_id, title, description, start_date, end_date, location, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [userId, title, description, start_date, end_date, location]);
    
    if (result.affectedRows === 1) {
      
      return res.redirect(`/exhibitions/${result.insertId}`);
    } else {
      throw new Error('Failed to create exhibition');
    }
  } catch (error) {
    console.error('Exhibition creation error:', error);
    errors.push('An error occurred while creating your exhibition. Please try again.');
    
    return res.render('createExhibition', {
      errors,
      formData: req.body
    });
  }
});



app.listen(PORT, () => {
  console.log(`Server is running at port ${PORT}`);
});
