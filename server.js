const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const SITE_URL = process.env.SITE_URL;
const API_URL = process.env.API_URL;
const DOWNLOAD_URL = process.env.DOWNLOAD_URL;

const ZEK_PRICE = Number(process.env.ZEK_PRICE || 49.90);
const MP_TEST = process.env.MP_TEST === "true";

const resend = RESEND_API_KEY
    ? new Resend(RESEND_API_KEY)
    : null;

// suficiente para o primeiro teste.
// Depois substituiremos por banco.
const pedidos = new Map();
const emailsEnviados = new Set();


// ======================================================
// CRIAR CHECKOUT
// ======================================================

app.post("/api/checkout", async (req, res) => {

    try {

        const email = String(req.body.email || "")
            .trim()
            .toLowerCase();

        if (!email || !email.includes("@")) {
            return res.status(400).json({
                erro: "Informe um e-mail válido."
            });
        }

        const pedidoId = crypto.randomUUID();

        pedidos.set(pedidoId, {
            email,
            criadoEm: new Date()
        });


        const preference = {

            items: [
                {
                    id: "zek",
                    title: "$Zek - Assistente Financeiro",
                    description: "Licença de uso do $Zek",
                    quantity: 1,
                    currency_id: "BRL",
                    unit_price: ZEK_PRICE
                }
            ],

            payer: {
                email
            },

            external_reference: pedidoId,

            back_urls: {

                success:
                    `${SITE_URL}/sucesso.html`,

                failure:
                    `${SITE_URL}/pagamento-falhou.html`,

                pending:
                    `${SITE_URL}/pagamento-pendente.html`
            },

            auto_return: "approved",

            notification_url:
                `${API_URL}/api/webhook`
        };


        const response = await fetch(
            "https://api.mercadopago.com/checkout/preferences",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    Authorization:
                        `Bearer ${MP_ACCESS_TOKEN}`
                },

                body: JSON.stringify(preference)
            }
        );


        const data = await response.json();

        if (!response.ok) {

            console.error(data);

            return res.status(500).json({
                erro: "Erro ao criar pagamento.",
                detalhes: data
            });
        }


        const checkoutUrl =
            MP_TEST
                ? data.sandbox_init_point
                : data.init_point;


        res.json({
            checkoutUrl
        });

    }
    catch (error) {

        console.error(error);

        res.status(500).json({
            erro: "Erro interno."
        });
    }
});


// ======================================================
// VALIDAR PAGAMENTO E LIBERAR DOWNLOAD
// ======================================================

app.get("/api/download", async (req, res) => {

    try {

        const paymentId =
            req.query.payment_id;

        if (!paymentId) {

            return res.status(400).json({
                liberado: false
            });
        }


        const response = await fetch(
            `https://api.mercadopago.com/v1/payments/${paymentId}`,
            {
                headers: {
                    Authorization:
                        `Bearer ${MP_ACCESS_TOKEN}`
                }
            }
        );


        const payment =
            await response.json();


        if (
            response.ok &&
            payment.status === "approved"
        ) {

            return res.json({

                liberado: true,

                downloadUrl:
                    DOWNLOAD_URL
            });

        }


        res.status(403).json({
            liberado: false,
            status: payment.status
        });

    }
    catch (error) {

        console.error(error);

        res.status(500).json({
            liberado: false
        });
    }

});


// ======================================================
// WEBHOOK MERCADO PAGO
// ======================================================

app.post("/api/webhook", async (req, res) => {

    try {

        const paymentId =
            req.body?.data?.id ||
            req.query["data.id"];


        if (!paymentId) {

            return res.sendStatus(200);
        }


        const response = await fetch(
            `https://api.mercadopago.com/v1/payments/${paymentId}`,
            {
                headers: {
                    Authorization:
                        `Bearer ${MP_ACCESS_TOKEN}`
                }
            }
        );


        const payment =
            await response.json();


        if (
            !response.ok ||
            payment.status !== "approved"
        ) {

            return res.sendStatus(200);
        }


        if (
            emailsEnviados.has(
                String(payment.id)
            )
        ) {

            return res.sendStatus(200);
        }


        const pedido =
            pedidos.get(
                payment.external_reference
            );


        const email =
            pedido?.email ||
            payment.payer?.email;


        if (!email) {

            console.log(
                "Pagamento aprovado, mas e-mail não encontrado."
            );

            return res.sendStatus(200);
        }


        const resultado =
            await resend.emails.send({

                from:
                    "$Zek <onboarding@resend.dev>",

                to: email,

                subject:
                    "Seu $Zek está disponível para download",

                html: `
                    <h2>Obrigado por comprar o $Zek!</h2>

                    <p>
                        Seu pagamento foi confirmado.
                    </p>

                    <p>
                        Clique abaixo para baixar:
                    </p>

                    <p>
                        <a href="${DOWNLOAD_URL}">
                            Baixar $Zek
                        </a>
                    </p>

                    <p>
                        Equipe $Zek
                    </p>
                `
            });


        console.log(
            "Resend:",
            resultado
        );


        emailsEnviados.add(
            String(payment.id)
        );


        res.sendStatus(200);

    }
    catch (error) {

        console.error(error);

        res.sendStatus(500);
    }

});


app.get("/", (req, res) => {

    res.send(
        "$Zek Checkout API funcionando."
    );

});


app.listen(PORT, () => {

    console.log(
        `$Zek API rodando na porta ${PORT}`
    );

});
