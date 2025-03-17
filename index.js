require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mercadopago = require('mercadopago');
const nodemailer = require('nodemailer');
const schedule = require('node-schedule');

const app = express();

// Middleware para parsing de JSON
app.use(express.json());

// Log para verificar a Connection String no ambiente
console.log('DATABASE_URL:', process.env.DATABASE_URL);

// Configuração do pool de conexão com o banco
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Função para inicializar o banco de dados
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS alerts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                exam_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS payments (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                payment_id VARCHAR(255),
                status VARCHAR(50),
                amount DECIMAL(10, 2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Tabelas criadas com sucesso!');
    } catch (err) {
        console.error('Erro ao criar tabelas:', err.stack);
        process.exit(1);
    }
}

// Teste de conexão com o banco
pool.connect((err) => {
    if (err) {
        console.error('Erro ao conectar ao banco:', err.stack);
        process.exit(1);
    }
    console.log('Conexão com o banco estabelecida!');
    initializeDatabase();
});

// Configuração do Nodemailer para envio de e-mails
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Configuração do Mercado Pago
mercadopago.configure({
    access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// Middleware para autenticação JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Acesso negado' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido' });
        req.user = user;
        next();
    });
};

// Rota para registro de usuário
app.post('/register', async (req, res) => {
    const { email, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
            [email, hashedPassword]
        );
        res.status(201).json({ user: result.rows[0] });
    } catch (err) {
        console.error('Erro ao registrar usuário:', err.stack);
        res.status(500).json({ error: 'Erro ao registrar usuário' });
    }
});

// Rota para login de usuário
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
            expiresIn: '1h'
        });
        res.json({ token });
    } catch (err) {
        console.error('Erro ao fazer login:', err.stack);
        res.status(500).json({ error: 'Erro ao fazer login' });
    }
});

// Rota para criar um alerta (requer autenticação)
app.post('/alerts', authenticateToken, async (req, res) => {
    const { exam_date } = req.body;
    const user_id = req.user.id;

    try {
        const result = await pool.query(
            'INSERT INTO alerts (user_id, exam_date) VALUES ($1, $2) RETURNING *',
            [user_id, exam_date]
        );

        // Agendar e-mail de lembrete (1 dia antes do vestibular)
        const alert = result.rows[0];
        const reminderDate = new Date(alert.exam_date);
        reminderDate.setDate(reminderDate.getDate() - 1);

        schedule.scheduleJob(reminderDate, async () => {
            const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [user_id]);
            const userEmail = userResult.rows[0].email;

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: userEmail,
                subject: 'Lembrete: Seu vestibular está chegando!',
                text: `Olá! Este é um lembrete para o seu vestibular no dia ${alert.exam_date}. Boa sorte!`
            };

            transporter.sendMail(mailOptions, (err, info) => {
                if (err) {
                    console.error('Erro ao enviar e-mail:', err.stack);
                } else {
                    console.log('E-mail enviado:', info.response);
                }
            });
        });

        res.status(201).json({ alert: result.rows[0] });
    } catch (err) {
        console.error('Erro ao criar alerta:', err.stack);
        res.status(500).json({ error: 'Erro ao criar alerta' });
    }
});

// Rota para criar um pagamento com Mercado Pago (requer autenticação)
app.post('/payment', authenticateToken, async (req, res) => {
    const { amount } = req.body;
    const user_id = req.user.id;

    try {
        const preference = {
            items: [
                {
                    title: 'Pagamento Vestibular Alerts',
                    unit_price: parseFloat(amount),
                    quantity: 1
                }
            ],
            back_urls: {
                success: 'https://vestibular-alerts.vercel.app/success',
                failure: 'https://vestibular-alerts.vercel.app/failure',
                pending: 'https://vestibular-alerts.vercel.app/pending'
            },
            auto_return: 'approved'
        };

        const response = await mercadopago.preferences.create(preference);
        const payment_url = response.body.init_point;

        await pool.query(
            'INSERT INTO payments (user_id, payment_id, status, amount) VALUES ($1, $2, $3, $4)',
            [user_id, response.body.id, 'pending', amount]
        );

        res.json({ payment_url });
    } catch (err) {
        console.error('Erro ao criar pagamento:', err.stack);
        res.status(500).json({ error: 'Erro ao criar pagamento' });
    }
});

// Rota para receber notificações do Mercado Pago
app.post('/webhook', async (req, res) => {
    const payment_id = req.body.data.id;

    try {
        const payment = await mercadopago.payment.findById(payment_id);
        const status = payment.body.status;

        await pool.query(
            'UPDATE payments SET status = $1 WHERE payment_id = $2',
            [status, payment_id]
        );

        res.status(200).send('Webhook recebido');
    } catch (err) {
        console.error('Erro no webhook do Mercado Pago:', err.stack);
        res.status(500).json({ error: 'Erro no webhook' });
    }
});

// Rota básica para testar a aplicação
app.get('/', (req, res) => {
    res.send('Aplicação funcionando!');
});

// Iniciar o servidor localmente (para testes)
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => {
        console.log('Servidor rodando na porta 3000');
    });
}

module.exports = app;