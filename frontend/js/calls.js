/**
 * WebRTC звонки — аудио и видео
 */
const Calls = {
    isInCall: false,
    isIncoming: false,
    callType: null,
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    targetUserId: null,
    targetUser: null,
    isCaller: false,
    isMuted: false,
    isVideoOff: false,
    callStartTime: null,
    timerInterval: null,
    currentFacingMode: 'user',
    incomingCallData: null,
    
    rtcConfig: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ]
    },

    init() {
        if (!App.socket) {
            console.log('⚠️ Socket не готов');
            return;
        }
        this.setupSocketHandlers();
        console.log('📞 Calls модуль готов');
    },

    setupSocketHandlers() {
        App.socket.on('incoming_call', (data) => {
            console.log('📞 Входящий звонок от', data.caller.display_name);
            this.handleIncomingCall(data);
        });

        App.socket.on('call_answered', async (data) => {
            console.log('✅ Звонок принят, получен answer');
            try {
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(data.answer)
                );
                console.log('✅ Remote description установлен');
                this.startTimer();
                this.updateStatus('В сети');
            } catch (e) {
                console.error('❌ Error setting remote description:', e);
            }
        });

        App.socket.on('ice_candidate', async (data) => {
            if (this.peerConnection && data.candidate) {
                try {
                    await this.peerConnection.addIceCandidate(
                        new RTCIceCandidate(data.candidate)
                    );
                    console.log('🧊 ICE candidate добавлен');
                } catch (e) {
                    console.error('❌ Error adding ICE candidate:', e);
                }
            }
        });

        App.socket.on('call_rejected', () => {
            Toast.show('Звонок отклонён', 'error');
            this.cleanup();
        });

        App.socket.on('call_ended', () => {
            Toast.show('Звонок завершён');
            this.cleanup();
        });

        App.socket.on('call_cancelled', () => {
            this.hideIncomingCall();
            Toast.show('Звонок отменён');
        });

        App.socket.on('call_failed', (data) => {
            Toast.show(data.reason || 'Не удалось позвонить', 'error');
            this.cleanup();
        });
    },

    async startCall(callType = 'audio') {
        if (!ChatUI.currentChat || !ChatUI.currentChat.other_user) {
            Toast.show('Звонок доступен только в личных чатах', 'error');
            return;
        }

        if (this.isInCall) {
            Toast.show('Вы уже в звонке', 'error');
            return;
        }

        this.callType = callType;
        this.targetUser = ChatUI.currentChat.other_user;
        this.targetUserId = this.targetUser.id;
        this.isCaller = true;
        this.isInCall = true;

        try {
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: callType === 'video' ? { facingMode: 'user' } : false
            };

            Toast.show('Запрашиваем доступ к ' + (callType === 'video' ? 'камере' : 'микрофону') + '...');

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('🎤 Локальный стрим получен:', this.localStream.getTracks().map(t => t.kind).join(', '));

            this.showCallScreen();
            this.updateStatus('Вызов...');

            if (callType === 'video') {
                const localVideo = document.getElementById('local-video');
                localVideo.srcObject = this.localStream;
                localVideo.play().catch(e => console.error('Local video play:', e));
            }

            this.createPeerConnection();

            this.localStream.getTracks().forEach(track => {
                console.log('➕ Добавляем локальный трек:', track.kind);
                this.peerConnection.addTrack(track, this.localStream);
            });

            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: callType === 'video'
            });
            await this.peerConnection.setLocalDescription(offer);
            console.log('📤 Offer создан и установлен');

            App.socket.emit('call_offer', {
                token: API.token,
                target_user_id: this.targetUserId,
                chat_id: ChatUI.currentChat.id,
                call_type: callType,
                offer: offer
            });

            Toast.show(`Звоним ${this.targetUser.display_name}...`);
        } catch (error) {
            console.error('❌ Ошибка начала звонка:', error);
            Toast.show('Ошибка: ' + error.message, 'error');
            this.cleanup();
        }
    },

    handleIncomingCall(data) {
        if (this.isInCall) {
            App.socket.emit('call_reject', {
                token: API.token,
                caller_user_id: data.caller.id
            });
            return;
        }

        this.isIncoming = true;
        this.incomingCallData = data;
        this.callType = data.call_type;
        this.targetUser = data.caller;
        this.targetUserId = data.caller.id;

        this.showIncomingCall();
        this.playRingtone();
    },

    async acceptIncoming() {
        if (!this.incomingCallData) return;

        this.stopRingtone();
        this.hideIncomingCall();
        this.isCaller = false;
        this.isInCall = true;

        try {
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: this.callType === 'video' ? { facingMode: 'user' } : false
            };

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('🎤 Локальный стрим получен:', this.localStream.getTracks().map(t => t.kind).join(', '));

            this.showCallScreen();
            this.updateStatus('Подключение...');

            if (this.callType === 'video') {
                const localVideo = document.getElementById('local-video');
                localVideo.srcObject = this.localStream;
                localVideo.play().catch(e => console.error('Local video play:', e));
            }

            this.createPeerConnection();

            this.localStream.getTracks().forEach(track => {
                console.log('➕ Добавляем локальный трек:', track.kind);
                this.peerConnection.addTrack(track, this.localStream);
            });

            await this.peerConnection.setRemoteDescription(
                new RTCSessionDescription(this.incomingCallData.offer)
            );
            console.log('📥 Offer установлен');

            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            console.log('📤 Answer создан');

            App.socket.emit('call_answer', {
                token: API.token,
                caller_user_id: this.targetUserId,
                answer: answer
            });

            this.startTimer();
            this.updateStatus('В сети');
            this.incomingCallData = null;
        } catch (error) {
            console.error('❌ Ошибка приёма звонка:', error);
            Toast.show('Ошибка: ' + error.message, 'error');
            this.rejectIncoming();
        }
    },

    rejectIncoming() {
        this.stopRingtone();
        if (this.incomingCallData) {
            App.socket.emit('call_reject', {
                token: API.token,
                caller_user_id: this.targetUserId
            });
        }
        this.hideIncomingCall();
        this.cleanup(false);
    },

    endCall() {
        if (this.isCaller && this.peerConnection && this.peerConnection.connectionState !== 'connected') {
            App.socket.emit('call_cancel', {
                token: API.token,
                target_user_id: this.targetUserId
            });
        } else if (this.targetUserId) {
            App.socket.emit('call_end', {
                token: API.token,
                target_user_id: this.targetUserId
            });
        }
        this.cleanup();
    },

    createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.rtcConfig);
        console.log('🔗 PeerConnection создан');

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🧊 Отправляем ICE candidate');
                App.socket.emit('call_ice_candidate', {
                    token: API.token,
                    target_user_id: this.targetUserId,
                    candidate: event.candidate
                });
            }
        };

        this.peerConnection.ontrack = (event) => {
            console.log('📺 Получен remote track:', event.track.kind);
            console.log('📺 Streams:', event.streams);
            
            if (!this.remoteStream) {
                this.remoteStream = new MediaStream();
            }
            
            this.remoteStream.addTrack(event.track);
            
            const remoteVideo = document.getElementById('remote-video');
            remoteVideo.srcObject = this.remoteStream;
            remoteVideo.muted = false;
            remoteVideo.volume = 1.0;
            
            remoteVideo.play().then(() => {
                console.log('✅ Remote play() success');
            }).catch(err => {
                console.error('❌ Ошибка воспроизведения:', err);
                // Пробуем ещё раз с задержкой
                setTimeout(() => {
                    remoteVideo.play().catch(e => console.error('Retry failed:', e));
                }, 500);
            });
            
            if (this.callType === 'audio') {
                remoteVideo.style.display = 'none';
                remoteVideo.style.width = '0';
                remoteVideo.style.height = '0';
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('🔗 Connection state:', state);
            
            if (state === 'connected') {
                this.updateStatus('В сети');
                if (!this.callStartTime) this.startTimer();
            } else if (state === 'disconnected' || state === 'failed') {
                Toast.show('Соединение потеряно', 'error');
                this.cleanup();
            }
        };
        
        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('🧊 ICE state:', this.peerConnection.iceConnectionState);
        };
        
        this.peerConnection.onsignalingstatechange = () => {
            console.log('📡 Signaling state:', this.peerConnection.signalingState);
        };
    },

    toggleMute() {
        if (!this.localStream) return;
        
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMuted;
        });

        const btn = document.getElementById('call-mute-btn');
        if (this.isMuted) {
            btn.classList.add('muted');
            btn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        } else {
            btn.classList.remove('muted');
            btn.innerHTML = '<i class="fas fa-microphone"></i>';
        }
    },

    toggleVideo() {
        if (!this.localStream || this.callType !== 'video') return;
        
        this.isVideoOff = !this.isVideoOff;
        this.localStream.getVideoTracks().forEach(track => {
            track.enabled = !this.isVideoOff;
        });

        const btn = document.getElementById('call-video-btn');
        if (this.isVideoOff) {
            btn.classList.add('muted');
            btn.innerHTML = '<i class="fas fa-video-slash"></i>';
        } else {
            btn.classList.remove('muted');
            btn.innerHTML = '<i class="fas fa-video"></i>';
        }
    },

    async switchCamera() {
        if (!this.localStream || this.callType !== 'video') return;
        
        try {
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
            
            this.localStream.getVideoTracks().forEach(track => track.stop());
            
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: this.currentFacingMode }
            });
            
            const newVideoTrack = newStream.getVideoTracks()[0];
            
            const sender = this.peerConnection.getSenders().find(s => 
                s.track && s.track.kind === 'video'
            );
            if (sender) {
                await sender.replaceTrack(newVideoTrack);
            }
            
            const oldVideoTracks = this.localStream.getVideoTracks();
            oldVideoTracks.forEach(t => this.localStream.removeTrack(t));
            this.localStream.addTrack(newVideoTrack);
            
            document.getElementById('local-video').srcObject = this.localStream;
        } catch (e) {
            Toast.show('Не удалось переключить камеру', 'error');
        }
    },

    showIncomingCall() {
        const modal = document.getElementById('incoming-call-modal');
        const avatar = document.getElementById('incoming-call-avatar');
        const name = document.getElementById('incoming-call-name');
        const type = document.getElementById('incoming-call-type');

        avatar.innerHTML = App.getAvatarHtml(this.targetUser);
        name.textContent = this.targetUser.display_name;
        
        const icon = this.callType === 'video' ? 'fa-video' : 'fa-phone';
        const text = this.callType === 'video' ? 'Видеозвонок' : 'Аудиозвонок';
        type.innerHTML = `<i class="fas ${icon}"></i><span>${text}</span>`;

        modal.style.display = 'flex';
    },

    hideIncomingCall() {
        document.getElementById('incoming-call-modal').style.display = 'none';
    },

    showCallScreen() {
        const screen = document.getElementById('call-screen');
        screen.style.display = 'flex';
        
        if (this.callType === 'video') {
            screen.classList.add('video-mode');
            screen.classList.remove('audio-mode');
            document.getElementById('call-video-btn').style.display = 'flex';
            document.getElementById('call-camera-switch').style.display = 'flex';
            document.getElementById('local-video').style.display = 'block';
        } else {
            screen.classList.add('audio-mode');
            screen.classList.remove('video-mode');
            document.getElementById('call-video-btn').style.display = 'none';
            document.getElementById('call-camera-switch').style.display = 'none';
            document.getElementById('local-video').style.display = 'none';
        }

        document.getElementById('call-audio-avatar').innerHTML = App.getAvatarHtml(this.targetUser);
        document.getElementById('call-audio-name').textContent = this.targetUser.display_name;
        document.getElementById('call-top-name').textContent = this.targetUser.display_name;
    },

    updateStatus(text) {
        const status = document.getElementById('call-audio-status');
        if (status) status.textContent = text;
    },

    startTimer() {
        if (this.timerInterval) return;
        
        this.callStartTime = Date.now();
        this.timerInterval = setInterval(() => {
            const seconds = Math.floor((Date.now() - this.callStartTime) / 1000);
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            
            const t1 = document.getElementById('call-audio-timer');
            const t2 = document.getElementById('call-top-timer');
            if (t1) t1.textContent = timeStr;
            if (t2) t2.textContent = timeStr;
        }, 1000);
    },

    playRingtone() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            this.ringtoneCtx = new AudioContext();
            this._playRingLoop();
        } catch (e) {}
    },

    _playRingLoop() {
        if (!this.ringtoneCtx || !this.isIncoming) return;

        try {
            const ctx = this.ringtoneCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.frequency.setValueAtTime(440, ctx.currentTime);
            osc.frequency.setValueAtTime(554, ctx.currentTime + 0.5);
            
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);
            
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 1);
            
            this.ringtoneTimer = setTimeout(() => this._playRingLoop(), 1500);
        } catch (e) {}
    },

    stopRingtone() {
        if (this.ringtoneTimer) {
            clearTimeout(this.ringtoneTimer);
            this.ringtoneTimer = null;
        }
        if (this.ringtoneCtx) {
            try { this.ringtoneCtx.close(); } catch(e) {}
            this.ringtoneCtx = null;
        }
    },

    cleanup(sendEnd = true) {
        this.stopRingtone();
        this.hideIncomingCall();

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        const localVideo = document.getElementById('local-video');
        const remoteVideo = document.getElementById('remote-video');
        if (localVideo) localVideo.srcObject = null;
        if (remoteVideo) {
            remoteVideo.srcObject = null;
            remoteVideo.style.display = '';
        }

        document.getElementById('call-screen').style.display = 'none';

        const muteBtn = document.getElementById('call-mute-btn');
        if (muteBtn) {
            muteBtn.classList.remove('muted');
            muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        }
        const videoBtn = document.getElementById('call-video-btn');
        if (videoBtn) {
            videoBtn.classList.remove('muted');
            videoBtn.innerHTML = '<i class="fas fa-video"></i>';
        }

        this.isInCall = false;
        this.isIncoming = false;
        this.callType = null;
        this.targetUserId = null;
        this.targetUser = null;
        this.isCaller = false;
        this.isMuted = false;
        this.isVideoOff = false;
        this.callStartTime = null;
        this.remoteStream = null;
        this.incomingCallData = null;
    }
};