'use client';
import type { Socket } from 'socket.io-client';

/**
 * Peer-to-peer voice call over WebRTC. Signaling (SDP + ICE) is relayed by the backend socket server
 * only between members of the same call. Media flows peer-to-peer or through the configured TURN server.
 * The customer is the offerer; staff answers.
 */
export class VoiceCall {
  pc: RTCPeerConnection | null = null;
  local: MediaStream | null = null;
  remoteAudio: HTMLAudioElement;
  private onSignal = (p: any) => { if (p.callId === this.callId) void this.handleSignal(p.signal); };
  constructor(private socket: Socket, public callId: string, private iceServers: RTCIceServer[], private onState: (s: string) => void) {
    this.remoteAudio = new Audio();
    this.remoteAudio.autoplay = true;
    socket.on('call:signal', this.onSignal);
  }
  private async setup() {
    this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.local.getTracks().forEach((t) => this.pc!.addTrack(t, this.local!));
    this.pc.ontrack = (e) => { this.remoteAudio.srcObject = e.streams[0]; };
    this.pc.onicecandidate = (e) => { if (e.candidate) this.socket.emit('call:signal', { callId: this.callId, signal: { candidate: e.candidate.toJSON() } }); };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      if (s) this.onState(s);
      if (s === 'failed') { this.socket.emit('call:failed', { callId: this.callId }); this.close(); }
    };
  }
  /** Customer side, after staff accepted. */
  async startAsCaller() {
    await this.setup();
    const offer = await this.pc!.createOffer({ offerToReceiveAudio: true });
    await this.pc!.setLocalDescription(offer);
    this.socket.emit('call:signal', { callId: this.callId, signal: { sdp: this.pc!.localDescription } });
  }
  /** Staff side, after accepting. Waits for the offer. */
  async prepareAsCallee() { await this.setup(); }
  private pending: RTCIceCandidateInit[] = [];
  private async handleSignal(sig: any) {
    if (!this.pc) await this.setup();
    if (sig?.sdp) {
      await this.pc!.setRemoteDescription(sig.sdp);
      for (const c of this.pending.splice(0)) await this.pc!.addIceCandidate(c).catch(() => undefined);
      if (sig.sdp.type === 'offer') {
        const ans = await this.pc!.createAnswer();
        await this.pc!.setLocalDescription(ans);
        this.socket.emit('call:signal', { callId: this.callId, signal: { sdp: this.pc!.localDescription } });
      }
    } else if (sig?.candidate) {
      if (this.pc!.remoteDescription) await this.pc!.addIceCandidate(sig.candidate).catch(() => undefined);
      else this.pending.push(sig.candidate);
    }
  }
  mute(m: boolean) { this.local?.getAudioTracks().forEach((t) => (t.enabled = !m)); }
  hangup(reason = 'hangup') { this.socket.emit('call:hangup', { callId: this.callId, reason }); this.close(); }
  close() {
    this.socket.off('call:signal', this.onSignal);
    this.local?.getTracks().forEach((t) => t.stop());
    this.pc?.close(); this.pc = null;
    this.remoteAudio.srcObject = null;
  }
}

export const webrtcSupported = () => typeof window !== 'undefined' && !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia;
