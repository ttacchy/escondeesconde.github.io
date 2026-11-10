# Esconde-Esconde: Objetos × Caçadores (versão GitHub Pages)

Jogo multijogador em HTML, CSS e JavaScript, 100% estático. Funciona no GitHub Pages sem servidor próprio.

## Como publicar no GitHub Pages

1. Crie um repositório no GitHub (pode ser público).
2. Envie **todos os arquivos desta pasta** para a raiz do repositório (botão *Add file → Upload files*).
3. Vá em **Settings → Pages**. Em *Build and deployment*, escolha **Deploy from a branch**, branch **main**, pasta **/ (root)** e salve.
4. Em 1 ou 2 minutos o jogo fica em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

Para testar no computador antes de publicar, rode `python3 -m http.server 8000` na pasta e abra `http://localhost:8000`.

## Como funciona o multijogador (sem servidor)

- Quem clica em **Criar sala** vira o **anfitrião**: a partida roda no navegador dele (`host.js`).
- Os outros digitam o **código de 4 letras** (ou abrem o link da sala) e conectam direto no anfitrião por WebRTC, usando o PeerJS (incluído em `peerjs.min.js`).
- O PeerJS usa o servidor público gratuito `0.peerjs.com` só para os jogadores se encontrarem. Depois disso os dados vão direto entre os navegadores.

## Cuidados

- **O anfitrião precisa manter a aba aberta** durante toda a partida. Se ele fechar, a sala acaba.
- Em algumas redes (Wi-Fi de empresa, escola, alguns 4G) a conexão direta pode falhar, porque não há servidor TURN. Se alguém não conseguir entrar, tente outra rede ou troque o anfitrião.
- O servidor público do PeerJS é gratuito e sem garantia de disponibilidade. Se quiser mais estabilidade, dá para hospedar o seu próprio (`peerjs-server`) e passar `host`, `port` e `path` ao criar o `Peer` em `game.js`.
- Os jogadores são os mesmos de antes: máximo de 12 por sala, teclado e mouse.

## Controles

| Tecla | Objetos | Caçadores |
|---|---|---|
| WASD / setas | mover | mover |
| E | copiar o objeto mais próximo | |
| Clique | | pegar um suspeito |
| Q | | sonar (recarga de 25 s) |

## Arquivos

- `index.html`, `style.css`: telas
- `game.js`: cliente (desenho, controles, rede)
- `host.js`: regras da partida, executadas no navegador do anfitrião
- `maps.js`: mapas, objetos e colisão
- `peerjs.min.js`: biblioteca PeerJS 1.5.4
