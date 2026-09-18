# GitHub Album

Álbum de fotos e vídeos hospedado pelo GitHub Pages, com catálogo em `gallery.json`.

## Importante

O GitHub Pages é um site estático. Para permitir upload pelo navegador, este projeto usa a REST API do GitHub.

**O token não fica no código e não é salvo no repositório.** Ele fica apenas no `sessionStorage` desta aba/sessão.

### Segurança

Crie um Fine-grained Personal Access Token no GitHub com acesso **somente ao repositório do álbum** e a permissão:

- Repository permissions → Contents → Read and write

Não coloque o token dentro de `app.js`, `index.html` ou qualquer arquivo publicado.

### Limitações

- Arquivos acima de 100 MB não são aceitos pelo Git normal.
- GitHub Pages tem limite recomendado de 1 GB para o site publicado.
- GitHub recomenda manter um repositório dentro de 10 GB.
- O conteúdo publicado pelo Pages é público.

Para um álbum grande, use Git LFS ou armazenamento de objetos/CDN em vez de transformar o GitHub em um serviço de mídia.

## Como publicar

1. Crie um repositório **público** no GitHub se estiver no GitHub Free.
2. Envie estes arquivos para a branch `main`.
3. Vá em Settings → Pages.
4. Em Build and deployment, escolha Deploy from a branch.
5. Escolha `main` e `/ (root)`.
6. Salve.
7. Abra o endereço fornecido pelo GitHub Pages.
8. Clique em Configurar.
9. Informe usuário, repositório, branch e seu Fine-grained token.
10. Clique em Salvar e conectar.

O `gallery.json` será criado automaticamente no primeiro upload.

## Estrutura criada automaticamente

media/
  2026/
    09/
      2026-09-17/
        1758140000000-foto.jpg

gallery.json

A data usada é a data escolhida no campo de data. Se nenhuma data for escolhida, o site usa a data atual do navegador.
