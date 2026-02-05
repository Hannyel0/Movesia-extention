/**
 * Configuration and logging setup for Movesia Agent Server.
 *
 * Provides centralized configuration with environment variable support
 * and sensible defaults for all WebSocket-related settings.
 */

import { config as dotenvConfig } from 'dotenv';
import {
    HeartbeatConfig,
    DEFAULT_HEARTBEAT_CONFIG
} from './types';

// Re-export for convenience (used by other modules)
export { UnityManagerConfig, DEFAULT_UNITY_MANAGER_CONFIG } from './types';

// Load environment variables
dotenvConfig();

// =============================================================================
// Logging Configuration
// =============================================================================

/** ANSI color codes for terminal output. */
export const LogColors = {
    RESET: '\x1b[0m',
    BOLD: '\x1b[1m',
    DIM: '\x1b[2m',

    // Foreground colors
    BLACK: '\x1b[30m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    WHITE: '\x1b[37m',

    // Bright foreground colors
    BRIGHT_BLACK: '\x1b[90m',
    BRIGHT_RED: '\x1b[91m',
    BRIGHT_GREEN: '\x1b[92m',
    BRIGHT_YELLOW: '\x1b[93m',
    BRIGHT_BLUE: '\x1b[94m',
    BRIGHT_MAGENTA: '\x1b[95m',
    BRIGHT_CYAN: '\x1b[96m',
    BRIGHT_WHITE: '\x1b[97m',

    // Background colors
    BG_GREEN: '\x1b[42m',
    BG_YELLOW: '\x1b[43m',
    BG_RED: '\x1b[41m',
    BG_BLUE: '\x1b[44m'
} as const;

/** Log levels. */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

/** Component styles for logging. */
const COMPONENT_STYLES: Record<string, { color: string; icon: string }> = {
    'movesia': { color: LogColors.BRIGHT_CYAN, icon: '🚀' },
    'movesia.unity': { color: LogColors.MAGENTA, icon: '🎮' },
    'movesia.chat': { color: LogColors.BLUE, icon: '💬' },
    'movesia.sessions': { color: LogColors.GREEN, icon: '🔗' },
    'movesia.heartbeat': { color: LogColors.YELLOW, icon: '💓' },
    'movesia.router': { color: LogColors.CYAN, icon: '📡' },
    'movesia.transport': { color: LogColors.BRIGHT_BLACK, icon: '📦' },
    'movesia.agent': { color: LogColors.BRIGHT_MAGENTA, icon: '🤖' },
    'movesia.streaming': { color: LogColors.BRIGHT_BLUE, icon: '⚡' }
};

/** Level styles for logging. */
const LEVEL_STYLES: Record<LogLevel, { color: string; label: string }> = {
    [LogLevel.DEBUG]: { color: LogColors.BRIGHT_BLACK, label: 'DBG' },
    [LogLevel.INFO]: { color: LogColors.GREEN, label: 'INF' },
    [LogLevel.WARN]: { color: LogColors.YELLOW, label: 'WRN' },
    [LogLevel.ERROR]: { color: LogColors.RED, label: 'ERR' }
};

/** Current global log level. */
let currentLogLevel = LogLevel.INFO;

/**
 * Simple logger factory.
 */
export function createLogger(component: string) {
    const style = COMPONENT_STYLES[component] ?? { color: LogColors.WHITE, icon: '•' };
    const shortName = component.replace('movesia.', '').toUpperCase() || 'SERVER';

    const formatMessage = (level: LogLevel, message: string): string => {
        const timestamp = new Date().toISOString().slice(11, 19);
        const levelStyle = LEVEL_STYLES[level];
        const isTTY = process.stdout.isTTY;

        if (isTTY) {
            return (
                `${LogColors.DIM}${timestamp}${LogColors.RESET} ` +
                `${levelStyle.color}${levelStyle.label}${LogColors.RESET} ` +
                `${style.icon} ${style.color}${shortName.padEnd(10)}${LogColors.RESET} ` +
                `${LogColors.BRIGHT_WHITE}${message}${LogColors.RESET}`
            );
        } else {
            return `${timestamp} ${levelStyle.label} ${shortName.padEnd(10)} ${message}`;
        }
    };

    return {
        debug: (message: string) => {
            if (currentLogLevel <= LogLevel.DEBUG) {
                console.log(formatMessage(LogLevel.DEBUG, message));
            }
        },
        info: (message: string) => {
            if (currentLogLevel <= LogLevel.INFO) {
                console.log(formatMessage(LogLevel.INFO, message));
            }
        },
        warn: (message: string) => {
            if (currentLogLevel <= LogLevel.WARN) {
                console.warn(formatMessage(LogLevel.WARN, message));
            }
        },
        error: (message: string, error?: Error) => {
            if (currentLogLevel <= LogLevel.ERROR) {
                console.error(formatMessage(LogLevel.ERROR, message));
                if (error?.stack) {
                    console.error(error.stack);
                }
            }
        }
    };
}

/**
 * Set the global log level.
 */
export function setLogLevel(level: LogLevel): void {
    currentLogLevel = level;
}

/**
 * Parse log level from string.
 */
export function parseLogLevel(level: string): LogLevel {
    switch (level.toUpperCase()) {
        case 'DEBUG': return LogLevel.DEBUG;
        case 'INFO': return LogLevel.INFO;
        case 'WARN': return LogLevel.WARN;
        case 'WARNING': return LogLevel.WARN;
        case 'ERROR': return LogLevel.ERROR;
        default: return LogLevel.INFO;
    }
}

/**
 * Print startup banner.
 */
export function printStartupBanner(host: string, port: number): void {
    const C = LogColors;
    const banner = `
${C.BRIGHT_CYAN}███╗   ███╗ ██████╗ ██╗   ██╗███████╗███████╗██╗ █████╗     ███████╗███████╗██╗   ██╗███████╗██████╗
████╗ ████║██╔═══██╗██║   ██║██╔════╝██╔════╝██║██╔══██╗    ██╔════╝██╔════╝██║   ██║██╔════╝██╔══██╗
██╔████╔██║██║   ██║██║   ██║█████╗  ███████╗██║███████║    ███████╗█████╗  ██║   ██║█████╗  ██████╔╝
██║╚██╔╝██║██║   ██║╚██╗ ██╔╝██╔══╝  ╚════██║██║██╔══██║    ╚════██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██╔══██╗
██║ ╚═╝ ██║╚██████╔╝ ╚████╔╝ ███████╗███████║██║██║  ██║    ███████║███████╗ ╚████╔╝ ███████╗██║  ██║
╚═╝     ╚═╝ ╚═════╝   ╚═══╝  ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝    ╚══════╝╚══════╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
${C.RESET}
  ${C.GREEN}▸ Server:${C.WHITE}  http://${host}:${port}
  ${C.MAGENTA}▸ Unity:${C.WHITE}   ws://${host}:${port}/ws/unity
  ${C.BLUE}▸ Chat:${C.WHITE}    ws://${host}:${port}/ws/chat/{session}
  ${C.YELLOW}▸ Status:${C.WHITE}  http://${host}:${port}/unity/status
${C.RESET}`;
    console.log(banner);
}

// Default logger
export const logger = createLogger('movesia');

// =============================================================================
// Server Configuration
// =============================================================================

/** Main server configuration. */
export interface ServerConfig {
    host: string;
    port: number;
    corsOrigins: string[];
    corsAllowCredentials: boolean;
    logLevel: string;
}

/** Default server configuration. */
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
    host: '127.0.0.1',
    port: 8765,
    corsOrigins: ['*'],
    corsAllowCredentials: true,
    logLevel: 'INFO'
};

/**
 * Create server config from environment variables.
 */
export function createServerConfig(): ServerConfig {
    return {
        host: process.env.SERVER_HOST ?? DEFAULT_SERVER_CONFIG.host,
        port: parseInt(process.env.SERVER_PORT ?? String(DEFAULT_SERVER_CONFIG.port), 10),
        corsOrigins: DEFAULT_SERVER_CONFIG.corsOrigins,
        corsAllowCredentials: DEFAULT_SERVER_CONFIG.corsAllowCredentials,
        logLevel: process.env.LOG_LEVEL ?? DEFAULT_SERVER_CONFIG.logLevel
    };
}

// =============================================================================
// Unity Configuration
// =============================================================================

/** Unity connection configuration. */
export interface UnityConfig {
    handshakeTimeout: number;
    commandTimeout: number;
    interruptTimeout: number;
    reconnectGracePeriod: number;
    maxPendingCommands: number;
    maxMessageSize: number;
}

/** Default Unity configuration. */
export const DEFAULT_UNITY_CONFIG: UnityConfig = {
    handshakeTimeout: 10.0,
    commandTimeout: 30.0,
    interruptTimeout: 120.0,
    reconnectGracePeriod: 5.0,
    maxPendingCommands: 100,
    maxMessageSize: 10 * 1024 * 1024  // 10MB
};

/**
 * Create Unity config from environment variables.
 */
export function createUnityConfig(): UnityConfig {
    return {
        handshakeTimeout: parseFloat(process.env.UNITY_HANDSHAKE_TIMEOUT ?? String(DEFAULT_UNITY_CONFIG.handshakeTimeout)),
        commandTimeout: parseFloat(process.env.UNITY_COMMAND_TIMEOUT ?? String(DEFAULT_UNITY_CONFIG.commandTimeout)),
        interruptTimeout: parseFloat(process.env.INTERRUPT_TIMEOUT ?? String(DEFAULT_UNITY_CONFIG.interruptTimeout)),
        reconnectGracePeriod: DEFAULT_UNITY_CONFIG.reconnectGracePeriod,
        maxPendingCommands: DEFAULT_UNITY_CONFIG.maxPendingCommands,
        maxMessageSize: DEFAULT_UNITY_CONFIG.maxMessageSize
    };
}

// =============================================================================
// Heartbeat Configuration
// =============================================================================

/**
 * Create heartbeat config from environment variables.
 */
export function createHeartbeatConfig(): HeartbeatConfig {
    return {
        sweepIntervalMs: parseInt(process.env.HEARTBEAT_SWEEP_MS ?? String(DEFAULT_HEARTBEAT_CONFIG.sweepIntervalMs), 10),
        pingAfterIdleMs: parseInt(process.env.HEARTBEAT_PING_AFTER_MS ?? String(DEFAULT_HEARTBEAT_CONFIG.pingAfterIdleMs), 10),
        maxIdleMs: parseInt(process.env.HEARTBEAT_MAX_IDLE_MS ?? String(DEFAULT_HEARTBEAT_CONFIG.maxIdleMs), 10),
        pongTimeoutMs: DEFAULT_HEARTBEAT_CONFIG.pongTimeoutMs,
        maxMissedPongs: DEFAULT_HEARTBEAT_CONFIG.maxMissedPongs,
        closingForceKillMs: DEFAULT_HEARTBEAT_CONFIG.closingForceKillMs,
        compileSuspendMs: parseInt(process.env.COMPILE_SUSPEND_MS ?? String(DEFAULT_HEARTBEAT_CONFIG.compileSuspendMs), 10),
        postCompileGraceMs: DEFAULT_HEARTBEAT_CONFIG.postCompileGraceMs
    };
}

// =============================================================================
// WebSocket Configuration
// =============================================================================

/** WebSocket protocol configuration. */
export interface WebSocketConfig {
    maxMessageSize: number;
    closeTimeout: number;
    protocolVersion: number;
    enableCompression: boolean;
    compressionLevel: number;
}

/** Default WebSocket configuration. */
export const DEFAULT_WEBSOCKET_CONFIG: WebSocketConfig = {
    maxMessageSize: 10 * 1024 * 1024,  // 10MB
    closeTimeout: 10.0,
    protocolVersion: 1,
    enableCompression: true,
    compressionLevel: 6
};

/**
 * Create WebSocket config from environment variables.
 */
export function createWebSocketConfig(): WebSocketConfig {
    return {
        maxMessageSize: parseInt(process.env.WS_MAX_MESSAGE_SIZE ?? String(DEFAULT_WEBSOCKET_CONFIG.maxMessageSize), 10),
        closeTimeout: DEFAULT_WEBSOCKET_CONFIG.closeTimeout,
        protocolVersion: DEFAULT_WEBSOCKET_CONFIG.protocolVersion,
        enableCompression: (process.env.WS_COMPRESSION ?? 'true').toLowerCase() === 'true',
        compressionLevel: DEFAULT_WEBSOCKET_CONFIG.compressionLevel
    };
}

// =============================================================================
// Composite Configuration
// =============================================================================

/** Complete application configuration. */
export interface Config {
    server: ServerConfig;
    unity: UnityConfig;
    heartbeat: HeartbeatConfig;
    websocket: WebSocketConfig;
}

/**
 * Create complete config from environment.
 */
export function createConfig(): Config {
    return {
        server: createServerConfig(),
        unity: createUnityConfig(),
        heartbeat: createHeartbeatConfig(),
        websocket: createWebSocketConfig()
    };
}

// =============================================================================
// Global Configuration Instance
// =============================================================================

/** Global config instance. */
export const config = createConfig();

// Convenience exports (for backwards compatibility)
export const SERVER_HOST = config.server.host;
export const SERVER_PORT = config.server.port;
export const UNITY_HANDSHAKE_TIMEOUT = config.unity.handshakeTimeout;
export const UNITY_COMMAND_TIMEOUT = config.unity.commandTimeout;
export const INTERRUPT_TIMEOUT = config.unity.interruptTimeout;
