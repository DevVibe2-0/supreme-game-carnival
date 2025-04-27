import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
  } from '@nestjs/websockets';
  import { Server,Socket } from 'socket.io';
  import { ConnectedSocket } from '@nestjs/websockets';
  
  interface GameState {
    type: string; // 'triqui' o 'ppt'
    board?: string[];         // Solo para triqui
    currentPlayer?: string;   // Solo para triqui
    moves?: { [playerId: string]: string }; // Solo para ppt
    winner: string | null;
    players: string[];
  }
  
  @WebSocketGateway({ cors: true })
  export class GameGateway {
    @WebSocketServer()
    server!: Server;
  
    private games: Record<string, GameState> = {};
  
    @SubscribeMessage('createGame')
    handleCreateGame(@MessageBody() data: { gameType: string }, @ConnectedSocket() client: Socket) {
        const gameId = this.generateId();
        const playerId = client.id; // <- Aquí obtienes correctamente el playerId desde el socket

        if (data.gameType === 'triqui') {
          this.games[gameId] = {
            type: 'triqui', // <-- Guardamos el tipo de juego
            board: Array(9).fill(''),
            currentPlayer: 'X',
            winner: null,
            players: [playerId],
          };
        } else if (data.gameType === 'ppt') {
          this.games[gameId] = {
            type: 'ppt',
            moves: {}, // para guardar el movimiento de cada jugador
            winner: null,
            players: [playerId],
          };
        } else {
          client.emit('error', 'Tipo de juego no soportado.');
          return;
        }     
        // Emitir solo al jugador que creó la partida
        this.server.to(playerId).emit('gameCreated', { id: gameId, playerId });
    }
  
    @SubscribeMessage('joinGame')
handleJoinGame(
  @MessageBody() data: { gameId: string },
  @ConnectedSocket() client: Socket,
) {
  const playerId = client.id;
  const game = this.games[data.gameId];

  if (!game) {
    client.emit('error', 'Game not found');
    return;
  }

  if (game.players.length >= 2) {
    client.emit('error', 'Game is full');
    return;
  }

  game.players.push(playerId);

  if (game.type === 'triqui') {
    const symbols = ['X', 'O'];
    game.players.forEach((pId, index) => {
      const symbol = symbols[index];
      console.log('Player joined (Triqui):', pId);
      this.server.to(pId).emit('startGame', { symbol, game });
    });
  } else if (game.type === 'ppt') {
    console.log('Player joined (PPT):', playerId);

    // Para PPT, cuando ya estén los 2 jugadores, avisamos que puede empezar
    if (game.players.length === 2) {
      game.players.forEach((pId) => {
        this.server.to(pId).emit('startGame', { symbol: pId,message: 'Juego de Piedra-Papel-Tijera iniciado', game });
      });
    }
  }
}

  
@SubscribeMessage('makeMove')
handleMakeMove(
  @MessageBody() data: { gameId: string; index: number; symbol: string }
) {
  const game = this.games[data.gameId];
  if (!game) return;

  if (game.type === 'triqui') {
    if (!game.board) return; // ahora protegemos el acceso
    if (game.winner || game.board[data.index]) return;
    if (game.currentPlayer !== data.symbol) return;

    game.board[data.index] = data.symbol;
    game.winner = this.checkWinner(game.board);

    if (!game.winner) {
      game.currentPlayer = game.currentPlayer === 'X' ? 'O' : 'X';
    }

    this.server.emit('updateGame', { gameId: data.gameId, game });
  }
}

@SubscribeMessage('makePPTMove')
handleMakePptMove(@MessageBody() data: { gameId: string; move: string }, @ConnectedSocket() client: Socket) {
  const game = this.games[data.gameId];
  console.log('Game makepptmove:', game);
  if (!game || game.winner) return;

  if (!game.moves) {
    game.moves = {}; // Asegurarse que existe moves
  }

  const playerId = client.id;

  // Registrar el movimiento del jugador
  game.moves[playerId] = data.move;

  // Verificar si ya jugaron ambos
  if (Object.keys(game.moves).length === 2) {
    const [player1, player2] = game.players;
    const move1 = game.moves[player1];
    const move2 = game.moves[player2];

    // Determinar el ganador
    console.log('Jugadas:', move1, move2);
    const winner = this.determinePptWinner(move1, move2);
    
    if (winner === 0) {
      game.winner = null; // Empate
      // Emitir resultado de empate
      this.server.to(player1).emit('pptResult', { yourMove: move1, opponentMove: move2, winner: null });
      this.server.to(player2).emit('pptResult', { yourMove: move2, opponentMove: move1, winner: null });

      // Esperar 2 segundos para mostrar el empate antes de reiniciar
      setTimeout(() => {
        game.moves = {};  // Limpiar movimientos
        game.winner = null;  // Limpiar el ganador

        // Emitir evento para que ambos jugadores vean que el juego ha terminado en empate y se reinicie
        this.server.to(player1).emit('resetGame', { gameId: data.gameId });
        this.server.to(player2).emit('resetGame', { gameId: data.gameId });
      }, 2000);  // Esperar 2 segundos
    } else {
      game.winner = winner === 1 ? player1 : player2;

      // Emitir el resultado de quien ha ganado
      this.server.to(player1).emit('pptResult', { yourMove: move1, opponentMove: move2, winner: game.winner });
      this.server.to(player2).emit('pptResult', { yourMove: move2, opponentMove: move1, winner: game.winner });
    }
  }
}
  private determinePptWinner(move1: string, move2: string): number {
    // 0: empate, 1: gana player1, 2: gana player2
    if (move1 === move2) return 0;
    
    if (
      (move1 === 'piedra' && move2 === 'tijera') ||
      (move1 === 'tijera' && move2 === 'papel') ||
      (move1 === 'papel' && move2 === 'piedra')
    ) {
      return 1;
    }
  
    return 2;
  }
    private generateId(): string {
      return Math.random().toString(36).substring(2, 8);
    }
  
    private checkWinner(board: string[]): string | null {
      const lines = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6],
      ];
  
      for (const [a, b, c] of lines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
          return board[a];
        }
      }
  
      if (board.every(cell => cell)) return 'Empate';
  
      return null;
    }
  }
  