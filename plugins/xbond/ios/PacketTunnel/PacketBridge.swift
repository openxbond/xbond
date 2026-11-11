import Darwin
import Foundation
import NetworkExtension

/// Adapts Apple's packet API to the Darwin framing used by both Go cores.
/// The two datagram sockets preserve packet boundaries across the adapter.
final class PacketBridge {
    let coreDescriptor: Int32
    private let peer: Int32
    private let flow: NEPacketTunnelFlow
    private let queue: DispatchQueue
    private var reader: DispatchSourceRead?
    private var running = false

    init(flow: NEPacketTunnelFlow, queue: DispatchQueue) throws {
        var sockets: [Int32] = [-1, -1]
        let result = sockets.withUnsafeMutableBufferPointer {
            socketpair(AF_UNIX, SOCK_DGRAM, 0, $0.baseAddress!)
        }
        guard result == 0 else { throw MobileFailure("Could not create the packet adapter.") }
        if fcntl(sockets[1], F_SETFL, O_NONBLOCK) == -1 {
            Darwin.close(sockets[0])
            Darwin.close(sockets[1])
            throw MobileFailure("Could not configure the packet adapter.")
        }
        coreDescriptor = sockets[0]
        peer = sockets[1]
        self.flow = flow
        self.queue = queue
    }

    func start() {
        running = true
        let source = DispatchSource.makeReadSource(fileDescriptor: peer, queue: queue)
        source.setEventHandler { [weak self] in self?.receive() }
        reader = source
        source.resume()
        readPackets()
    }

    func stop() {
        running = false
        reader?.cancel()
        reader = nil
    }

    /// Hands the core a duplicate of the adapter socket. sing-tun closes the
    /// fd it adopts when the core stops, while this side keeps the original
    /// and closes it in deinit — the same ownership split the Android side
    /// applies (XBondVpnService dup comment); without it, a stop closes the
    /// number once and deinit closes it again, killing whatever reused it.
    func coreHandoff() throws -> Int32 {
        let duplicate = dup(coreDescriptor)
        guard duplicate != -1 else {
            throw MobileFailure("Could not hand the packet adapter to the core.")
        }
        return duplicate
    }

    deinit {
        Darwin.close(coreDescriptor)
        Darwin.close(peer)
    }

    private func readPackets() {
        flow.readPackets { [weak self] packets, protocols in
            guard let self else { return }
            queue.async { [weak self] in
                guard let self, running else { return }
                for (packet, number) in zip(packets, protocols) {
                    let family = number.int32Value
                    guard family == AF_INET || family == AF_INET6 else { continue }
                    var header = UInt32(family).bigEndian
                    var frame = Data(bytes: &header, count: MemoryLayout<UInt32>.size)
                    frame.append(packet)
                    // A full packet queue drops the datagram, as a TUN
                    // interface would, rather than blocking VPN shutdown.
                    frame.withUnsafeBytes { bytes in
                        _ = send(self.peer, bytes.baseAddress, bytes.count, 0)
                    }
                }
                readPackets()
            }
        }
    }

    private func receive() {
        guard running else { return }
        var frame = [UInt8](repeating: 0, count: 65_539)
        var packets: [Data] = []
        var protocols: [NSNumber] = []
        // Yield the serial queue to lifecycle callbacks between batches.
        for _ in 0..<64 {
            let length = frame.withUnsafeMutableBytes { bytes in
                recv(peer, bytes.baseAddress, bytes.count, 0)
            }
            if length < 0 { break }
            guard length > 4, frame[0...2].allSatisfy({ $0 == 0 }) else { continue }
            let family = Int32(frame[3])
            guard family == AF_INET || family == AF_INET6 else { continue }
            packets.append(Data(frame[4..<length]))
            protocols.append(NSNumber(value: family))
        }
        if !packets.isEmpty {
            _ = flow.writePackets(packets, withProtocols: protocols)
        }
    }
}
