# Mock TLS certificate (TEST ONLY)

Self-signed certificate for `localhost` / `127.0.0.1`, valid 10 years, generated with:

```
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -subj "/CN=localhost/O=LikeABosch mock (TEST ONLY)" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout mock-key.pem -out mock-cert.pem
```

The private key is committed on purpose: it only protects the local mock server used in tests,
and mirrors the self-signed certificate a real DICENTIS server ships with. Never use it for anything else.
